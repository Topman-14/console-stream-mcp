# mobius-mcp

Give AI coding agents (Claude Code, Codex CLI, Gemini CLI, etc.) live access to your web app's runtime — console logs, errors, and network requests — without copy-pasting anything into chat.

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

A browser client (extension or npm package) captures runtime events — `console.*`, uncaught errors, unhandled rejections, `fetch`/`XHR` calls — and streams them over a WebSocket to a local MCP server. The MCP server keeps a rolling in-memory history and exposes it to AI agents as MCP tools.

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

```bash
npm install
npm run build

# start the MCP server
npm run start --workspace=apps/mcp-server
```

Then either load the unpacked extension from `apps/browser-extension/dist`, or add the npm client to your app:

```ts
import { startMobiusStream } from "mobius-client";

startMobiusStream();
```

Point your MCP-compatible agent at the server (see `apps/mcp-server/README.md` for configuration).

### Enabling capture (extension)

The extension never captures anything by default. Click its toolbar icon and hit "Enable capture" on the tab you want to debug — that's the one opt-in. Multiple tabs can be enabled independently. For dev servers you always want captured without clicking every time, add a rule (e.g. `localhost:5173`) on the extension's settings page (right-click the icon → Options) — matching tabs auto-enable on navigation.

## MCP Tools

* `get_recent_logs`
* `get_recent_errors`
* `get_network_requests`
* `get_logs_since`
* `clear_logs`
* `get_connected_tabs`
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
| Console/error/network event streaming | ✅ | ✅ |
| `get_recent_logs` / `get_recent_errors` / `get_network_requests` / `get_logs_since` | ✅ | ✅ |
| Multi-tab awareness (`get_connected_tabs`, `set_active_tab`) | ✅ | ✅ (one entry per app instance) |
| Opt-in capture (popup toggle / settings-page rules) | ✅ | n/a — capture starts as soon as `startMobiusStream()` runs |
| Navigation control (`navigate_to`, `reload_tab`, `switch_tab`) | ✅ (planned) | ❌ |
| Debug sessions (`start_debug_session`) | ✅ (planned) | ✅ (planned, event types available to it) |
| Screenshots, DOM/accessibility snapshots | ✅ (planned, requires CDP) | ❌ |
| CPU/memory profiling, Web Vitals | ✅ (planned, requires CDP) | ❌ |
| `evaluate_js`, network response bodies | ✅ (planned, requires CDP) | ❌ |
| React/Redux/Zustand state, storage inspection | ✅ (planned) | ✅ (planned, page-context only — no cross-origin iframes) |

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
