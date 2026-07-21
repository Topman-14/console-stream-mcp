# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup

```bash
npm install
```

Root-only. This is an npm workspaces monorepo (`apps/*`, `packages/*`) — installing inside an individual workspace folder fights the root's symlinked `node_modules` and is never necessary.

### Build

```bash
npm run build
```

Builds every workspace in dependency order: `packages/capture-core` → `apps/mcp-server` / `apps/npm-client` / `apps/browser-extension`. The apps consume `packages/capture-core`'s built `dist/` output, not its TypeScript source — after editing it, rebuild before an app will see the change (or use watch mode).

Build one workspace:

```bash
npm run build -w packages/capture-core
npm run build -w apps/mcp-server
```

### Watch mode (active development)

```bash
npm run watch
```

Does a one-time build of `packages/capture-core`, then runs three labeled watchers in parallel: `[packages]` (`tsc -b --watch`), the extension's Vite dev server + esbuild watcher for the standalone content-script/injected bundles, and `apps/mcp-server`'s `tsup --watch`. Load the extension once via `chrome://extensions` → Developer Mode → Load unpacked → `apps/browser-extension/dist`; background/popup/options changes hot-reload via crxjs, but `content-script.ts`/`injected.ts` changes only take effect the next time they're injected (reload the target tab or toggle capture off/on).

If only the shared packages need rebuilding (e.g. working on `apps/npm-client` or `apps/mcp-server` without the extension watchers):

```bash
npm run watch -w packages/capture-core
```

### Run the MCP server from source

```bash
npm run start --workspace=apps/mcp-server
```

### Test / lint

`npm run test` and `npm run lint` exist at the root (`--workspaces --if-present`) and run in CI, but no workspace currently defines a `test` or `lint` script — there is no test suite or lint config in this repo yet.

## Architecture

One shared package implements one pipeline: a browser client captures runtime events and streams them over a local WebSocket to a Node server, which exposes them to AI agents as MCP tools over stdio.

```
apps/browser-extension/   Chrome MV3 extension — captures events in the page, streams over WS
apps/npm-client/          Lightweight alternative to the extension for direct app integration (paused, no CDP)
apps/mcp-server/          WS hub + MCP tool server (stdio)
packages/capture-core/    Shared capture logic (console/network/error/navigation patching + redaction)
                           and the wire-protocol types (ClientMessage/ServerMessage/ControlMessage, event
                           schema) every workspace above compiles against
skills/                   Scenario-focused agent skills (dead clicks, silent API failures, contract drift, etc.)
```

### Capture pipeline (extension)

Three separate JS execution contexts are involved per tab, because an isolated-world content script cannot patch the page's real `window.fetch`/`console`:

1. **`apps/browser-extension/injected.ts`** runs in the page's MAIN world. It calls `startCapture()` (`packages/capture-core/src/index.ts`), which monkey-patches `console.*`, `window.fetch`/`XMLHttpRequest`, `history.pushState`/`replaceState`, and (opt-in) a `MutationObserver`. Captured events are relayed out via `window.postMessage`.
2. **`apps/browser-extension/src/content-script.ts`** runs in the isolated world. It relays `postMessage`d events to the background worker via `chrome.runtime.sendMessage`, and answers the injected script's `"ready"` handshake with capture/privacy settings read from `chrome.storage` (the MAIN-world script has no storage access).
3. **`apps/browser-extension/src/background.ts`** (MV3 service worker) is the hub: `enableTab()` injects both scripts (`chrome.scripting.executeScript`, one in `world: "MAIN"`), owns the WebSocket connection to `apps/mcp-server`, and relays received events onto it. It also handles inbound `"command"` messages from the server (screenshots, `evaluate_js`, CDP calls via `src/lib/cdp.ts`) for tools that need live browser control rather than just stored events.

Auto-enable per site is rule-based (`src/lib/rules.ts` + `src/lib/host-permissions.ts`), evaluated on `chrome.webNavigation.onCommitted` — capture is opt-in per tab otherwise (popup toggle).

### mcp-server

- **`src/wsServer.ts`** — the WebSocket hub browser clients connect to (`ws://localhost:7331` by default, `CONSOLE_STREAM_PORT` env override).
- **`src/store.ts`** (`EventStore`/`TabBuffer`) — per-tab in-memory ring buffer (capped, oldest evicted), with a single `seq` counter shared across all tabs so `get_logs_since` cursors stay globally orderable.
- **`src/registry.ts`** (`ClientRegistry`) — tracks connected clients; keeps a disconnected client around for a grace period (`PURGE_DELAY_MS`) so a page refresh doesn't instantly wipe its history.
- **`src/commandDispatcher.ts`** — request/reply RPC over the same WS connection (`sendCommand` + matching `ack`), used for anything that isn't passive event capture (navigation, screenshots, `evaluate_js`, profiling).
- **`src/mcpServer.ts`** (`createMcpServer`) — defines every MCP tool; each either reads `EventStore` directly or calls `dispatcher.sendCommand()`. Tools requiring CDP (`chrome.debugger`) only work with the extension client, gated by `requireCdp()`.
- **Hub/follower pattern**: only one `mobius-mcp` process per machine can bind the WS port. If a second process (e.g. a second Claude Code session's own spawned server) loses that bind race (`EADDRINUSE`), it becomes a **follower**: `src/controlClient.ts` forwards its MCP tool calls to the hub over a `control-request`/`control-response` channel (`ControlMessage`, defined in `packages/capture-core`) instead of running a dead registry no browser can reach. See `src/index.ts` and `createFollowerMcpServer` in `src/mcpServer.ts`.

### Protocol (wire types)

`packages/capture-core/src/types.ts` is the single source of truth for the wire format both the extension and the server compile against — `ClientMessage` (`hello`/`event`/`bye`/`ack`), `ServerMessage` (`command`), `ControlMessage` (follower forwarding), and the `BrowserEvent` union (console/error/network/navigation/dom-mutation). `packages/capture-core/src/data.ts` holds `PROTOCOL_VERSION`, checked on every connection via `isProtocolVersionSupported()` (`utils/protocol.ts`) — bump it when the message shape changes. `apps/mcp-server` depends on `@mobius-mcp/capture-core` purely for these types/values (it doesn't use the DOM-patching functions); `types.ts` and `data.ts` have no DOM dependency, so this is safe to import from Node.

## Conventions

- **Strict kebab-case filenames.** New files and folders must use kebab-case (e.g. `use-logs-port.ts`, `capture-options.ts`). Note: `apps/mcp-server/src` predates this and has camelCase filenames (`mcpServer.ts`, `controlClient.ts`, `wsServer.ts`, `commandDispatcher.ts`, `debugSession.ts`, `eventCategories.ts`, `waitFor.ts`) — don't mass-rename these as a drive-by; only rename a file when you're already editing it for an explicit, related task.
- **Smallest possible diff.** Scope every fix or update to exactly what was asked. Don't fold in unrelated cleanup, renames, or refactors into the same change, even if you notice something else worth improving — call it out separately instead.
- **No unsolicited changes.** Don't add, remove, or refactor anything beyond the explicit ask.
- **DRY / proper abstraction.** Shared logic belongs in one place, not duplicated across call sites — but only extract it when doing requested work in that area (see "smallest possible diff"), not as a standalone pass over unrelated code.
- **A package's `src/` separates types, static data, and logic.** `types.ts` holds every type/interface/enum (especially ones reused across files, e.g. `Emit`, `RedactionOptions`); `data.ts` holds static constants/config objects derived from those types (e.g. `PROTOCOL_VERSION`, `DEFAULT_REDACTION`); generic helper functions move to a `utils/` folder, split into files by what they operate on or what they import (e.g. `packages/capture-core/src/utils/{stringify,headers,body,dom,redact,protocol}.ts`) rather than dumped alongside the package's primary exported functions or piled into one large `utils.ts`. See `packages/capture-core/src/` for the reference layout.
- **No comments except non-obvious WHY.** Default to no comments. The few that exist explain a hidden constraint or a workaround (e.g. the `NOTIFICATION_ICON` comment in `background.ts` explaining why it's a PNG, not SVG) — never restate what the code already says.
- **No unnecessary backward-compatibility scaffolding.** Don't keep a thing around, or add indirection, just in case something might still need it — every type/value should have exactly one place to import it from. This is why `packages/protocol` no longer exists: it was a separate package whose entire contents were types also usable straight from `packages/capture-core` (which every consumer already depended on), so it only added a second import path and a build step for no benefit — its contents now live in `packages/capture-core/src/types.ts`/`data.ts` directly. Watch for the same shape elsewhere:
  - A barrel file re-exporting a name that already has one canonical home, "for convenience."
  - Keeping an old function signature, parameter, or exported alias around after every call site has moved off it, instead of deleting it.
  - `try/catch` or `??`/fallback branches defending against a case the calling code structurally can't produce.
  - A feature flag or config toggle left in place after the rollout it was for is finished and the old path is dead.
  - Commented-out old code kept "in case we need it again" — git history already has it.
