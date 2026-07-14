<div align="center">
  <img src="./apps/browser-extension/public/icons/icon-128.png" alt="mobius-mcp" width="72" height="72" />

  <h1>mobius-mcp</h1>

  <a href="https://www.npmjs.com/package/mobius-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/mobius-mcp.svg"></a>
  <a href="https://www.npmjs.com/package/mobius-mcp"><img alt="npm downloads" src="https://img.shields.io/npm/dm/mobius-mcp.svg"></a>
  <a href="./LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/Topman-14/console-stream-mcp/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Topman-14/console-stream-mcp/actions/workflows/ci.yml/badge.svg"></a>
</div>

Give AI coding agents (Claude Code, Codex CLI, Gemini CLI, etc.) live access to your web app's runtime — console logs, errors, network requests, and navigation events — without copy-pasting anything into chat.

Local-first. No cloud services, no telemetry, no external APIs.

## How it works

```
Web App
  │
Extension OR npm package
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

A browser client (extension or npm package) captures runtime events — `console.*`, uncaught errors, unhandled rejections, `fetch`/`XHR` calls, and navigation (including SPA route changes via `pushState`/`replaceState`/hash) — and streams them over a WebSocket to a local MCP server. The MCP server keeps a rolling in-memory history and exposes it to AI agents as MCP tools.

## Packages

| Path | Description |
| --- | --- |
| `apps/mcp-server` | Node.js MCP server; WebSocket hub + MCP tool implementations |
| `apps/browser-extension` | Chromium extension that captures and streams browser events |
| `apps/npm-client` | `mobius-client` npm package for direct app integration |
| `packages/protocol` | Versioned event schema and message envelope (private, bundled into published packages) |
| `packages/capture-core` | Runtime hook patching shared by the extension and npm client (private, bundled) |
| `skill` | Agent skill describing when/how to use the MCP tools to debug a web app |
| `examples` | Example apps demonstrating integration |

## Quick start

`mobius-mcp` is published on npm — no clone required to use it.

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

2. **Stream your app's runtime into it**, either via the browser extension (load unpacked from `apps/browser-extension/dist`, see below), or by dropping the npm client into your app:

   ```bash
   npm install mobius-client
   ```

   ```ts
   import { startMobiusStream } from "mobius-client";

   startMobiusStream();
   ```

3. Ask your agent to check the tab's console/errors/network/navigation via the MCP tools below.

### Developing this repo locally

```bash
npm install
npm run build

# start the MCP server from source instead of npx
npm run start --workspace=apps/mcp-server
```

### Enabling capture (extension)

The extension never captures anything by default. Click its toolbar icon and hit "Enable tab" on the tab you want to debug — that's the one opt-in. Multiple tabs can be enabled independently. For dev servers you always want captured without clicking every time, add a rule (e.g. `localhost:5173`) on the extension's settings page (right-click the icon → Options) — matching tabs auto-enable on navigation.

## MCP Tools

* `get_recent_logs`
* `get_recent_errors`
* `get_network_requests`
* `get_logs_since`
* `clear_logs`
* `get_connected_tabs`
* `get_capture_settings` — which event categories (console/errors/network/navigation/dom) a connected tab is actively capturing, so an empty result from another tool can be distinguished from "that category is off"
* `set_active_tab`
* `navigate_to`, `switch_tab`, `reload_tab` — browser control (extension only)
* `list_tabs` — every open tab, not just capture-enabled ones (requires an extension connected somewhere)
* `get_job_status`, `get_job_result`, `cancel_job` — for longer-running operations added in later stages (recordings, profiling)
* `start_debug_session`, `end_debug_session` — record a time-ordered timeline of console/network/navigation/DOM events instead of correlating separate snapshots by hand (single-tab, doesn't survive a full-page navigation)
* `wait_for_console_error`, `wait_for_navigation`, `wait_for_request`, `wait_for_element` — block (with timeout) until a condition occurs instead of polling `get_logs_since` in a loop
* `take_screenshot`, `capture_full_page`, `capture_element` — extension only, requires `chrome.debugger` (CDP)
* `capture_dom`, `capture_accessibility_tree` — extension only, requires CDP
* `evaluate_js` — run arbitrary JS in a tab and get the result; extension only, requires CDP, fully open (no read-only enforcement)
* `get_response_body`, `export_har` — extension only for `get_response_body` (requires CDP); `export_har` works from stored network events for either client but never includes bodies
* `start_cpu_profile`, `start_memory_profile` — extension only, requires CDP, job-based (see `get_job_status`/`get_job_result`)

CDP tools (marked "requires CDP" above) make Chrome show a persistent "being debugged" banner on the tab once used — the debugger attaches on first use and stays attached, it doesn't attach/detach per call. This is a Chrome-level indicator, not something the extension can suppress. `start_cpu_profile`/`start_memory_profile` durations are capped at 60s and best-effort beyond ~25-30s — Chrome can terminate an idle MV3 background service worker, which would cut a long profile short.

## Client capabilities

Event ingestion (console/errors/network) is identical across both browser clients — the server can't tell them apart. Command capabilities are not: many later-stage features require Chrome DevTools Protocol access, which only the extension has. The protocol reports this via a `capabilities` field on connect, so commands a client can't support fail with a clear error instead of hanging.

| Capability | Browser extension | npm client (`mobius-client`) |
| --- | --- | --- |
| Console/error/network/navigation event streaming | ✅ | ✅ |
| `get_recent_logs` / `get_recent_errors` / `get_network_requests` / `get_logs_since` | ✅ | ✅ |
| Multi-tab awareness (`get_connected_tabs`, `set_active_tab`, `get_capture_settings`) | ✅ | ✅ (one entry per app instance) |
| Opt-in capture (popup toggle / settings-page rules) | ✅ | n/a — capture starts as soon as `startMobiusStream()` runs |
| Browser control (`navigate_to`, `reload_tab`, `switch_tab`) | ✅ | ❌ |
| Debug sessions (`start_debug_session`/`end_debug_session`) | ✅ | ✅ (console/network/navigation event types only — no DOM mutations) |
| Screenshots, DOM/accessibility snapshots | ✅ (requires CDP) | ❌ |
| CPU/memory profiling | ✅ (requires CDP) | ❌ |
| `evaluate_js`, network response bodies | ✅ (requires CDP) | ❌ |
| React/Redux/Zustand state, storage inspection | ❌ (planned) | ❌ (planned) |

See [ROADMAP.md](./ROADMAP.md) for what "planned" maps to by stage.

## Design principles

* Local-first, zero cloud dependencies, zero telemetry
* Framework agnostic
* Extension and npm client emit an identical, versioned protocol — the server can't tell them apart

See [PROJECT.md](./PROJECT.md) for the full design doc and [ROADMAP.md](./ROADMAP.md) for staged future work.

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a PR. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
