<div align="center">
  <img src="./apps/browser-extension/public/icons/icon-128.png" alt="mobius-mcp" width="72" height="72" />

  <h1>mobius-mcp</h1>

  <a href="https://www.npmjs.com/package/mobius-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/mobius-mcp.svg"></a>
  <a href="https://www.npmjs.com/package/mobius-mcp"><img alt="npm downloads" src="https://img.shields.io/npm/dm/mobius-mcp.svg"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/Topman-14/mobius-mcp/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Topman-14/mobius-mcp/actions/workflows/ci.yml/badge.svg"></a>
</div>

Give AI coding agents (Claude Code, Codex CLI, Gemini CLI, etc.) live access to your web app's runtime — console logs, errors, network requests, and navigation events — without copy-pasting anything into chat.

Local-first. No cloud services, no telemetry, no external APIs.

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Repo layout](#repo-layout)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Enabling capture (extension)](#enabling-capture-extension)
- [MCP tools](#mcp-tools)
- [Client capabilities](#client-capabilities)
- [Skills](#skills)
- [Design principles](#design-principles)
- [Roadmap](#roadmap)
- [Smoke-test app](#smoke-test-app)
- [Contributing](#contributing)
- [License](#license)

## Features

- Live `console.*`, error, network (`fetch`/XHR), and navigation streaming into MCP tools — ask your agent instead of pasting logs into chat
- Multi-tab aware, opt-in capture per tab (nothing streams until you enable it)
- `start_debug_session`/`end_debug_session` — one ordered timeline instead of hand-correlating separate snapshots
- `wait_for_*` tools block (with timeout) instead of polling in a loop
- Full [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) capability set via the browser extension: screenshots, DOM/accessibility snapshots, `evaluate_js`, CPU/memory profiling
- HAR 1.2 export with full request/response bodies — truncated or skipped inline bodies are re-fetched over CDP when the extension is connected
- Recent history survives an MCP server restart (crash-safe temp-file persistence, self-pruning — see [Configuration](#configuration))
- Local-first: everything runs on `localhost`, zero cloud services, zero telemetry

## How it works

```
Web App
  │
Browser extension
  │
WebSocket
  │
localhost
  │
mobius-mcp
  │
MCP
  │
Claude Code / Codex / Gemini CLI
```

A browser client captures runtime events — `console.*`, uncaught errors, unhandled rejections, `fetch`/`XHR` calls, and navigation (including SPA route changes via `pushState`/`replaceState`/hash) — and streams them over a WebSocket to a local MCP server. The MCP server keeps a rolling history (in-memory, backed by on-disk persistence — see [Configuration](#configuration)) and exposes it to AI agents as MCP tools.

## Repo layout

| Path | Description |
| --- | --- |
| `apps/mcp-server` | Node.js MCP server; WebSocket hub + MCP tool implementations |
| `apps/browser-extension` | Chromium extension that captures and streams browser events |
| `apps/npm-client` | `mobius-client` npm package for direct app integration — **development paused**, see [Roadmap](#roadmap) |
| `packages/capture-core` | Versioned event schema/message envelope plus runtime hook patching, shared by the extension, npm client, and mcp-server (private, bundled) |
| `skills` | Six scenario-focused agent skills for specific bug classes (dead clicks, silent 200s, contract drift, perf, session drift, bug documentation) — see [Skills](#skills) |
| `examples` | Example apps demonstrating integration |

## Getting started

`mobius-mcp` is published on npm — no clone required to use it. (Contributing to this repo instead? See [Contributing](#contributing).)

1. **Register the MCP server with your agent.** For Claude Code:

   ```bash
   claude mcp add mobius-mcp -- npx -y mobius-mcp
   ```

   Or add it directly to your MCP client's config (Claude Code, Codex CLI, Gemini CLI, etc. all read a JSON config in this shape):

   ```json
   {
     "mcpServers": {
       "mobius-mcp": {
         "command": "npx",
         "args": ["-y", "mobius-mcp"]
       }
     }
   }
   ```

2. **[Install the browser extension](https://chromewebstore.google.com/detail/bdhnfoelpknephokgkldjopdggkakdop?utm_source=item-share-cb).** This is currently the only supported way to stream a tab's runtime into the server — [see below](#client-capabilities) for why.

   Click the toolbar icon and hit "Enable tab" on the tab you want to debug — capture is opt-in per tab, nothing streams by default (see [Enabling capture](#enabling-capture-extension)).

   > An npm package (`mobius-client`) for direct app integration without the extension exists but **development is paused** — see [Roadmap](#roadmap) for why. It still works at its baseline (console/error/network/navigation capture only) if the extension truly isn't an option for your setup, but isn't the recommended path right now.

3. **Ask your agent to check the tab's console/errors/network via the MCP tools below** (e.g. "check the browser console for errors").

## Configuration

The server reads these environment variables on startup — set them in the `env` block of your MCP client's server config:

```json
{
  "mcpServers": {
    "mobius-mcp": {
      "command": "npx",
      "args": ["-y", "mobius-mcp"],
      "env": { "CONSOLE_STREAM_PERSISTENCE_TTL_MS": "7200000" }
    }
  }
}
```

| Variable | Default | Description |
| --- | --- | --- |
| `CONSOLE_STREAM_PORT` | `7331` | WebSocket port the browser client connects to |
| `CONSOLE_STREAM_MAX_EVENTS_PER_TAB` | `3000` | Event history cap per tab, both in-memory and on disk |
| `CONSOLE_STREAM_PURGE_DELAY_MS` | `300000` (5 min) | Grace period after a tab disconnects before its buffer is purged (survives a quick page refresh) |
| `CONSOLE_STREAM_PERSISTENCE_DIR` | `<os temp dir>/mobius-mcp/events` | Where per-tab event history is persisted to disk, so it survives an MCP server restart |
| `CONSOLE_STREAM_PERSISTENCE_TTL_MS` | `3600000` (1 hour) | How long persisted events are kept before being pruned from disk |

## Enabling capture (extension)

The extension never captures anything by default. Click its toolbar icon and hit "Enable tab" on the tab you want to debug — that's the one opt-in. Multiple tabs can be enabled independently. For dev servers you always want captured without clicking every time, add a rule (e.g. `localhost:5173`) on the extension's settings page (right-click the icon → Options) — matching tabs auto-enable on navigation.

## MCP tools

* `get_recent_logs`
* `get_recent_errors`
* `get_network_requests` — includes request/response headers and size-capped, redacted request/response bodies for text-like content-types (both browser clients, no CDP needed)
* `get_logs_since`
* `clear_logs`
* `get_connected_tabs`
* `get_capture_settings` — which event categories (console/errors/network/navigation/dom) a connected tab is actively capturing, so an empty result from another tool can be distinguished from "that category is off"
* `set_active_tab`
* `navigate_to`, `switch_tab`, `reload_tab` — browser control (extension only)
* `list_tabs` — every open tab, not just capture-enabled ones (requires an extension connected somewhere)
* `get_job_status`, `get_job_result`, `cancel_job` — for longer-running operations (recordings, profiling)
* `start_debug_session`, `end_debug_session` — record a time-ordered timeline of console/network/navigation/DOM events instead of correlating separate snapshots by hand (single-tab, doesn't survive a full-page navigation)
* `wait_for_console_error`, `wait_for_navigation`, `wait_for_request`, `wait_for_element` — block (with timeout) until a condition occurs instead of polling `get_logs_since` in a loop
* `take_screenshot`, `capture_full_page`, `capture_element` — extension only, requires `chrome.debugger` (CDP)
* `capture_dom`, `capture_accessibility_tree` — extension only, requires CDP
* `evaluate_js` — run arbitrary JS in a tab and get the result; extension only, requires CDP, fully open (no read-only enforcement)
* `get_response_body`, `get_request_body` — extension only, requires CDP; fallback for the rare body `get_network_requests` couldn't capture (binary, oversized, non-text content-type)
* `export_har` — HAR 1.2 export with full request/response bodies; a body capture missed inline is re-fetched over CDP when the extension is connected (binary bodies come back base64-encoded)
* `start_cpu_profile`, `start_memory_profile` — extension only, requires CDP, job-based (see `get_job_status`/`get_job_result`)

CDP tools (marked "requires CDP" above) make Chrome show a persistent "being debugged" banner on the tab once used — the debugger attaches on first use and stays attached, it doesn't attach/detach per call. This is a Chrome-level indicator, not something the extension can suppress. `start_cpu_profile`/`start_memory_profile` durations are capped at 60s and best-effort beyond ~25-30s — Chrome can terminate an idle MV3 background service worker, which would cut a long profile short.

## Client capabilities

Event ingestion (console/errors/network) is identical across both browser clients — the server can't tell them apart. Command capabilities are not: many later-stage features require Chrome DevTools Protocol access, which only the extension has. The protocol reports this via a `capabilities` field on connect, so commands a client can't support fail with a clear error instead of hanging.

| Capability | Browser extension | npm client (`mobius-client`, paused) |
| --- | --- | --- |
| Console/error/network/navigation event streaming | ✅ | ✅ |
| `get_recent_logs` / `get_recent_errors` / `get_network_requests` / `get_logs_since` | ✅ | ✅ |
| Multi-tab awareness (`get_connected_tabs`, `set_active_tab`, `get_capture_settings`) | ✅ | ✅ (one entry per app instance) |
| Opt-in capture (popup toggle / settings-page rules) | ✅ | n/a — capture starts as soon as `startMobiusStream()` runs |
| Browser control (`navigate_to`, `reload_tab`, `switch_tab`) | ✅ | ❌ |
| Debug sessions (`start_debug_session`/`end_debug_session`) | ✅ | ✅ (console/network/navigation event types only — no DOM mutations) |
| Screenshots, DOM/accessibility snapshots | ✅ (requires CDP) | ❌ |
| CPU/memory profiling | ✅ (requires CDP) | ❌ |
| `evaluate_js` | ✅ (requires CDP) | ❌ |
| Network request/response headers + bodies (via `get_network_requests`) | ✅ | ✅ |
| Full-body HAR export (`export_har`), `get_request_body`/`get_response_body` fallback | ✅ (requires CDP for the fallback fetch) | ❌ (inline-captured bodies only) |
| React/Redux/Zustand state, storage inspection | ❌ (planned) | ❌ (planned) |

See [Roadmap](#roadmap) for what "planned" maps to by stage.

## Skills

`skills/<name>/SKILL.md` — six scenario-focused skills, each a workflow for a specific bug class that's hard to catch by reading source alone but tractable with live browser data:

| Skill | Catches |
| --- | --- |
| `mobius-dead-click` | A button/link/form that "does nothing" — pins down whether the handler never fired, failed silently, or hit a silent API failure |
| `mobius-silent-api-failure` | An API returning `200 OK` with an error-shaped body (`success: false`, a GraphQL `errors` array) — invisible to status-code-only checks |
| `mobius-contract-drift` | A response whose live JSON shape no longer matches the TypeScript type the frontend expects (renamed/missing fields) |
| `mobius-document-reproduced-bug` | Turns a confirmed-but-unsolved repro into a write-up — screenshot, timeline, HAR — offering to save it as a Markdown file with the screenshot embedded |
| `mobius-perf-stakeout` | Isolates "this feels slow" into network-bound, CPU-bound, or a memory leak building up over repeated use |
| `mobius-session-drift` | A silently dropped auth/session mid-flow — the exact request where an auth header stops being sent |

## Design principles

* Local-first, zero cloud dependencies, zero telemetry
* Framework agnostic
* Extension and npm client emit an identical, versioned protocol — the server can't tell them apart

## Roadmap

Staged build history and planned future work — including why the npm client is paused, and what's left for framework introspection (React/Redux/Zustand state, storage inspection) — live in [ROADMAP.md](./ROADMAP.md).

## Smoke-test app

`examples/spa-smoke-test` is a small React + `react-router-dom` SPA built to exercise every capture path at once in one place, rather than hunting for a real app that happens to trigger all of them: a range of `console.log`/`info`/`warn`/`error` payload shapes (objects, arrays, circular refs, BigInt, long strings, PII-shaped strings for redaction), multiple ways to trigger uncaught errors and unhandled promise rejections, `fetch`/XHR requests covering 200/404/500/slow/network-failure/POST, route/param/search-param changes, and DOM mutations. Useful for smoke-testing changes to this repo, or just seeing what mobius-mcp captures before wiring it into a real app. Requires a clone (not part of the published npm package) — see [Contributing](#contributing) below for setup.

```bash
cd examples/spa-smoke-test
npm install
npm run dev
```

Open the served URL, enable capture on the tab via the browser extension, click through `/scenarios`, then ask your agent to inspect the results via the [MCP tools](#mcp-tools) above — try `get_capture_settings` first, to rule out "that category is off" before assuming a missing event is a bug. Scenarios are extensible: see [examples/README.md](./examples/README.md) for the full list and how to add new ones.

## Contributing

Contributions are welcome — please open an issue to discuss significant changes before submitting a PR. Guidelines and PR expectations are in [CONTRIBUTING.md](./CONTRIBUTING.md); local setup instructions are below.

This is an npm workspaces monorepo (`apps/*`, `packages/*`). A single install at the root wires up every package — `npm install` inside an individual `apps/`/`packages/` folder is never necessary and will just fight the workspace symlinks in the root `node_modules`.

```bash
git clone https://github.com/Topman-14/mobius-mcp.git
cd mobius-mcp
npm install
npm run build
```

`npm run build` builds every workspace in dependency order (`packages/capture-core` → the apps), since `apps/browser-extension`, `apps/mcp-server`, and `apps/npm-client` all consume the built `dist/` output of the shared package, not its TypeScript source.

To run the MCP server from source instead of via `npx`:

```bash
npm run start --workspace=apps/mcp-server
```

### Watch mode

For active development across the shared packages and the extension, run:

```bash
npm run watch
```

This does a one-time build of `packages/capture-core` (so nothing is resolved against a missing `dist/` on a cold start), then runs three watchers in parallel with labeled output:

* `[packages]` — `tsc -b --watch` for `packages/capture-core`, incrementally rebuilding on save
* `[vite]` — the extension's Vite dev server, which also drives crxjs's automatic extension reload in Chrome for background/popup/options changes
* `[content-scripts]` — an esbuild watcher for `content-script.ts`/`injected.ts`, which are bundled as standalone IIFEs outside Vite's module graph (see the comment in `apps/browser-extension/vite.config.ts`)

Load the extension once via `chrome://extensions` → enable Developer Mode → **Load unpacked** → select `apps/browser-extension/dist`. From then on:

* Edits to `packages/capture-core` propagate through to the extension's bundled output automatically.
* Edits to background/popup/options files trigger Vite/crxjs's automatic reload in Chrome.
* Edits to `content-script.ts`/`injected.ts` rebuild immediately, but since those are injected on demand via `chrome.scripting.executeScript`, the new code takes effect the next time they're injected (reload the target tab, or toggle capture off/on) rather than needing an extension reload.

If you only need the shared package rebuilding (e.g. while working on `apps/npm-client` or `apps/mcp-server`) without the extension's Vite/esbuild watchers, run `npm run watch -w packages/capture-core` directly instead.

## License

[MIT](./LICENSE)
