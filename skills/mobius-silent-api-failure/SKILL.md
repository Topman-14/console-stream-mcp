---
name: mobius-silent-api-failure
description: Catch APIs that return HTTP 200 with an error-shaped payload — success:false, empty data, a GraphQL errors array alongside status 200 — a blind spot status-code-only monitoring misses entirely. Use when a feature looks broken but no request actually failed, via mobius-mcp.
---

# mobius-silent-api-failure

Everyone checks `status` first. That's exactly why this bug class survives so long in production: a request that returns `200 OK` with `{ "success": false, "error": "..." }`, an empty result where data was expected, or a GraphQL response with a top-level `errors` array (GraphQL almost always answers 200 regardless of outcome) looks completely healthy to anything watching status codes alone. `get_network_requests` now captures response bodies inline — this is the first time that's actually inspectable without a manual DevTools trawl.

## When to use this

- A feature "looks broken" (blank state, stale data, a form that doesn't seem to save) but no request errored and no console error fired.
- Debugging anything GraphQL-backed, where a failed mutation/query is still a 200.
- Before concluding "the network's fine" just because you skimmed status codes.

## Workflow

1. `get_connected_tabs`/`set_active_tab`, `clear_logs`, then reproduce the flow (ask the user, or drive it yourself via `navigate_to`/`evaluate_js` if scriptable).
2. `get_network_requests` (or `get_logs_since` for a live-in-progress repro) — inspect **every** request with `status` in 200–299, not just the failed-looking ones.
3. For each, read `responseBody` (or `get_response_body` if it was omitted/truncated — check `responseBodyOmittedReason` for why) for failure signals:
   - `{"success": false, ...}` / `{"error": ...}` / `{"ok": false, ...}`
   - A GraphQL `{"errors": [...]}` array — present even when `data` is also populated
   - `data: null`, or an empty array/object where the UI clearly expected content
4. Cross-check `requestBody` too — sometimes the request itself was malformed (missing field, wrong shape) and the backend accepted it anyway without validating, silently no-op'ing server-side.
5. Report the exact request plus the specific error-shaped field you found — "the `/api/checkout` POST returned 200 but `body.success` is `false` with `error: "card_declined"`" is useful; "an API failed" is not.

## Notes

- `responseBody` is only captured for text-like content-types (JSON/XML/text/form/GraphQL) — if `responseBodyOmittedReason` says non-text content-type, this technique doesn't apply to that request.
- Large bodies are truncated (~20,000 chars, see `responseBodyTruncated`) — for a huge payload where the error signal might be past the cutoff, fall back to `get_response_body` for the full text.
- This pairs naturally with `mobius-dead-click`: a "dead" button that actually fired a 200 request is very often this exact bug.
