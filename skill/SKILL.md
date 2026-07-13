---
name: console-stream-mcp
description: Live browser runtime visibility (console logs, errors, network requests) for a web app via the console-stream-mcp server. Use when debugging a running web app instead of asking the user to paste console output or network errors.
---

# console-stream-mcp

`console-stream-mcp` is a local MCP server that streams live browser runtime events (console logs, uncaught errors, unhandled promise rejections, fetch/XHR requests) from a web app into the agent's context, via a browser extension or the `console-stream-client` npm package.

## When to use this

Reach for these tools whenever you're debugging a web app that's running locally and connected to console-stream-mcp, instead of asking the user to copy-paste browser console output, error messages, or network traces:

- The user reports a bug, error, or unexpected behavior in a running web app.
- You need to confirm whether a code change actually fixed a runtime error.
- You're investigating a failed network request (status code, payload, timing).
- You want to watch console output live while reproducing a bug.

Do not use it for build-time/compile errors, server-side logs, or static code analysis — those come from the terminal or source, not the browser runtime.

## Available tools

- `get_recent_logs` — recent `console.log`/`console.info` output.
- `get_recent_errors` — recent `console.error`, `window.onerror`, and unhandled rejections, including stack traces.
- `get_network_requests` — recent `fetch`/`XMLHttpRequest` calls with status and timing.
- `get_connected_tabs` — which browser tabs are currently streaming events, and which one is the current default (`active: true`).
- `set_active_tab(tabId)` — set the default tab for the rest of this session, so other tools don't need `tabId` on every call.
- `get_logs_since(cursor)` — poll for events newer than a cursor, for tracking new output during live reproduction.
- `clear_logs` — reset the in-memory event history for a tab (e.g. before reproducing a bug, to isolate new output).

All of `get_recent_logs`, `get_recent_errors`, `get_network_requests`, `get_logs_since`, and `clear_logs` accept an optional `tabId`. If omitted: with exactly one tab connected it's used automatically; with none connected you get a clear error; with multiple connected and no `set_active_tab` call yet, you get an error listing the candidates instead of silently mixing two apps' logs together.

### Browser control (extension only)

- `navigate_to(url, tabId?)`, `reload_tab(tabId?)`, `switch_tab(tabId?)` — control a connected tab directly, e.g. to drive a repro instead of asking the user to click through it.
- `list_tabs()` — every open browser tab (not just capture-enabled ones), via any connected extension. Use this to tell the user which tab to enable if the one you need isn't connected yet.
- `get_job_status(jobId)` / `get_job_result(jobId)` / `cancel_job(jobId)` — for longer-running operations (recordings, profiling) introduced in later stages; not needed for the tools above, which return immediately.

### Debug sessions and waiting

Prefer these over manual polling when you're about to ask the user to reproduce something:

- `start_debug_session(tabId?, capture: ["console","network","navigation","dom"])` → `sessionId`, then `end_debug_session(sessionId)` → one time-ordered timeline instead of correlating separate `get_recent_*` calls by hand. Ends when the tab navigates (its `clientId` changes) — for flows that redirect, prefer `wait_for_navigation`/`wait_for_request` around the redirect instead of one long session spanning it.
- `wait_for_console_error(tabId?, timeoutMs?)`, `wait_for_navigation(tabId?, timeoutMs?)`, `wait_for_request(tabId?, urlPattern, timeoutMs?)`, `wait_for_element(tabId?, selector, timeoutMs?)` (extension only) — block until the condition occurs or timeout, instead of a `get_logs_since` poll loop. All return `{ timedOut: true }` (or `{ found: false }` for `wait_for_element`) on timeout rather than erroring — check for that before assuming the event happened.

### Visual/DOM/runtime capture (extension only, requires Chrome DevTools Protocol)

These attach `chrome.debugger` to the tab on first use (shows Chrome's "being debugged" banner) and need the browser extension specifically — calling them on an npm-client-only tab returns a clear error, not a hang.

- `take_screenshot(tabId?)` / `capture_full_page(tabId?)` / `capture_element(tabId?, selector)` — visual state, useful for layout/rendering bugs that don't show up in logs.
- `capture_dom(tabId?)` / `capture_accessibility_tree(tabId?)` — current DOM as HTML, or the accessibility tree.
- `evaluate_js(tabId?, expression)` — run arbitrary JS in the tab and get the result back (e.g. inspect a variable, call a function). No read-only restriction — it can mutate the page.
- `get_response_body(tabId?, requestUrl)` — response body for a recent request by URL (only available for requests made since the tab connected). `export_har(tabId?)` — captured network requests as HAR (no bodies included).
- `start_cpu_profile(tabId?, durationMs?)` / `start_memory_profile(tabId?, durationMs?)` — job-based (poll `get_job_status`/`get_job_result`); best-effort beyond ~25-30s since Chrome can kill an idle extension background worker mid-profile.

## Workflow

1. Check `get_connected_tabs` to confirm a tab is streaming. If it doesn't show the tab you expect, **that means capture isn't enabled there yet** — it is not a broken server. Ask the user to click the console-stream-mcp extension icon and enable capture on that tab (capture is opt-in per tab; a settings-page rule can also auto-enable it for a matching host/port, but nothing streams by default).
2. If multiple tabs are connected, use `set_active_tab` (or pass `tabId` explicitly) to pick the right one before querying — don't guess.
3. Optionally `clear_logs` before asking the user to reproduce the issue, so the next output is isolated. For a multi-step repro you want fully correlated, prefer `start_debug_session`/`end_debug_session` over manual `clear_logs` + polling.
4. Use `get_recent_errors` / `get_network_requests` / `get_recent_logs` to inspect what happened, poll `get_logs_since(cursor)` (starting at `cursor: 0`, then passing back the returned cursor each call), or use a `wait_for_*` tool to block until the specific thing you're watching for happens.
5. Correlate stack traces and failed requests with the source code to identify the root cause.

All data is in-memory and local — nothing leaves the machine.
