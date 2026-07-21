# mobius-mcp

MCP server that maintains a live stream of browser runtime events — console logs, errors, network requests, and navigation — and exposes them to AI coding agents (Claude Code, Codex CLI, Gemini CLI, etc.) as MCP tools. Recent history is in-memory for fast reads, mirrored to disk so it survives a server restart (see [Configuration](#configuration)).

Local-first: everything runs on `localhost`, no cloud services, no telemetry, no external APIs.

Pair it with a browser-side client:

- **[Mobius browser extension](https://chromewebstore.google.com/detail/bdhnfoelpknephokgkldjopdggkakdop?utm_source=item-share-cb)** — Chromium extension, adds browser control, screenshots, DOM/accessibility snapshots, CPU/memory profiling, and `evaluate_js` on top of event streaming (via `chrome.debugger`/CDP). Interactive: you can click around and trigger events yourself while the agent inspects them, instead of the agent driving headless automation blind.
- **[`mobius-client`](https://www.npmjs.com/package/mobius-client)** — drop-in npm package for direct app integration, no extension required, streams console/error/network/navigation events only. **Development is currently paused** (see the [root ROADMAP.md](https://github.com/Topman-14/mobius-mcp/blob/main/ROADMAP.md) for why) — the extension is the recommended client.

Source: https://github.com/Topman-14/mobius-mcp

## Table of contents

- [Install](#install)
- [Usage](#usage)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [MCP tools](#mcp-tools)
- [Client capabilities](#client-capabilities)
- [License](#license)

## Install

```bash
npm install -g mobius-mcp
```

Or run it directly with `npx` (no install) — see below.

## Usage

Register it with your MCP client. For Claude Code:

```bash
claude mcp add mobius-mcp -- npx -y mobius-mcp
```

Or add it directly to your MCP client's config — Claude Code, Codex CLI, Gemini CLI, Cursor, etc. all read a JSON config in this shape:

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

Then [install the browser extension](https://chromewebstore.google.com/detail/bdhnfoelpknephokgkldjopdggkakdop?utm_source=item-share-cb) and click "Enable tab" on the page you're debugging — capture is opt-in per tab, nothing streams by default.

Once a browser tab is connected, ask your agent to check its console, errors, network activity, or DOM — no copy-pasting logs into chat.

## How it works

```
Web App
  │
Browser extension
  │
WebSocket
  │
mobius-mcp (localhost)
  │
MCP (stdio)
  │
Your AI agent
```

The browser client captures `console.*`, uncaught errors, unhandled promise rejections, `fetch`/`XHR` calls, and navigation (including SPA route changes via `pushState`/`replaceState`/hash), and streams them over a WebSocket to this server. The server keeps a rolling history per tab — in-memory for fast reads, mirrored to disk in the background so a crash or restart doesn't lose it (see [Configuration](#configuration)) — and exposes it to the connected MCP client as tools.

## Configuration

Set these as environment variables in your MCP client's server config (the `env` block shown in [Usage](#usage) above):

| Variable | Default | Description |
| --- | --- | --- |
| `CONSOLE_STREAM_PORT` | `7331` | WebSocket port the browser client connects to |
| `CONSOLE_STREAM_MAX_EVENTS_PER_TAB` | `3000` | Event history cap per tab, both in-memory and on disk |
| `CONSOLE_STREAM_PURGE_DELAY_MS` | `300000` (5 min) | Grace period after a tab disconnects before its buffer is purged (survives a quick page refresh) |
| `CONSOLE_STREAM_PERSISTENCE_DIR` | `<os temp dir>/mobius-mcp/events` | Where per-tab event history is persisted to disk |
| `CONSOLE_STREAM_PERSISTENCE_TTL_MS` | `3600000` (1 hour) | How long persisted events are kept before being pruned from disk (pruned on an interval, roughly a quarter of the TTL) |

## MCP tools

**Event queries**
- `get_recent_logs` — recent `console.log`/`info`/`warn`
- `get_recent_errors` — recent `console.error`, `window.onerror`, unhandled rejections
- `get_network_requests` — recent `fetch`/`XHR` requests
- `get_logs_since` — poll for events after a cursor, for streaming/tailing
- `clear_logs` — clear a tab's in-memory history
- `get_capture_settings` — which categories a tab is actively capturing, so an empty result can be told apart from "that category is off"

**Tab management**
- `get_connected_tabs` — tabs currently streaming events
- `set_active_tab` — default tab for calls that omit `tabId`
- `list_tabs` — every open tab, not just capture-enabled ones (extension only)

**Browser control** (extension only)
- `navigate_to`, `switch_tab`, `reload_tab`

**Debug sessions**
- `start_debug_session` / `end_debug_session` — record a time-ordered timeline of console/network/navigation/DOM events for a tab instead of correlating separate snapshots by hand

**Waiting on conditions** (block with timeout instead of polling)
- `wait_for_console_error`, `wait_for_navigation`, `wait_for_request`, `wait_for_element`

**Visual/DOM capture** (extension only, requires `chrome.debugger`/CDP)
- `take_screenshot`, `capture_full_page`, `capture_element`
- `capture_dom`, `capture_accessibility_tree`

**Code execution & network detail**
- `evaluate_js` — run arbitrary JavaScript in the tab and get the result; extension only, requires CDP, fully open, no read-only enforcement — it's the developer's own browser and app
- `get_response_body`, `get_request_body` — extension only, requires CDP; fallback for the rare body `get_network_requests` couldn't capture (binary, oversized, non-text content-type)
- `export_har` — export captured network requests as a HAR 1.2 file with full request/response bodies; a body capture missed inline is re-fetched over CDP when the extension is connected (binary bodies come back base64-encoded)

**Profiling** (extension only, requires CDP, job-based — see `get_job_status`/`get_job_result`/`cancel_job`)
- `start_cpu_profile`, `start_memory_profile`

CDP-backed tools make Chrome show a persistent "being debugged" banner on the tab once used (a Chrome-level indicator, not something the extension can suppress). Profiling durations are capped at 60s and best-effort beyond ~25-30s, since Chrome can terminate an idle MV3 background worker.

## Client capabilities

| Capability | Browser extension | npm client (`mobius-client`, paused) |
| --- | --- | --- |
| Console/error/network/navigation streaming | ✅ | ✅ |
| Multi-tab awareness | ✅ | ✅ (one entry per app instance) |
| Browser control (navigate/reload/switch) | ✅ | ❌ |
| Debug sessions | ✅ | ✅ (no DOM mutations) |
| Screenshots, DOM/accessibility snapshots | ✅ | ❌ |
| CPU/memory profiling | ✅ | ❌ |
| `evaluate_js`, `get_request_body`/`get_response_body` | ✅ | ❌ |
| Full-body HAR export (`export_har`) | ✅ (CDP fallback for missed bodies) | ✅ (inline-captured bodies only) |

## License

[MIT](https://github.com/Topman-14/mobius-mcp/blob/main/LICENSE)
