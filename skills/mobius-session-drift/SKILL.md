---
name: mobius-session-drift
description: Catch a silently dropped auth/session mid-flow — a request that should carry an Authorization/session header stops carrying it, or a 401 shows up buried in an otherwise-normal request stream nobody was watching. Use for "I got logged out for no reason" or intermittent auth failures, via mobius-mcp.
---

# mobius-session-drift

Session drops rarely announce themselves. The UI might just quietly show stale or empty data while looking fine, or a background poll starts failing while the visible page is untouched — nobody's staring at the Network tab when it happens, so by the time it's reported, the moment it broke is long gone. Because `get_network_requests` now carries `requestHeaders` on every entry, that moment is reconstructable after the fact.

## When to use this

- "I got logged out for no reason" / "it just stopped working" with no clear trigger.
- Intermittent 401/403s the user didn't consciously notice.
- Background polling or long-lived sessions (dashboards, editors left open) that degrade silently over time.

## Workflow

1. `get_connected_tabs`/`set_active_tab`.
2. Get a window of history to inspect: `start_debug_session(capture: ["network", "console", "navigation"])` if reproducing live, or `get_logs_since(cursor)` from a cursor near login/page-load if the drift already happened during this session.
3. Pull `get_network_requests` and look across the sequence of same-origin/API calls at `requestHeaders` for the auth-carrying header — typically `authorization` or a session `cookie`. Note: if the "Redact sensitive body fields"/header redaction settings are on, the *value* reads `[redacted]`, but the header's **presence or absence** is still visible — that's all this technique needs.
4. Walk the sequence forward and find the first request where that header is missing compared to earlier ones, or where `status` flips to 401/403 without the user consciously doing anything.
5. Correlate timing at that point: does it line up with a token-refresh interval, the tab going idle/backgrounded, a navigation/redirect that reset in-memory auth state, or does an earlier request's `responseBody` contain an explicit logout/expiry signal (e.g. a refresh-token call that itself failed)?
6. Report the exact request where drift starts and what changed at that point — not just "auth is broken somewhere in this session."

## Notes

- Don't ask the user to turn off header redaction to see this — presence/absence survives redaction by design, only the value is masked.
- If the app stores auth in a cookie rather than a header, the same presence/absence check applies to the `cookie` entry in `requestHeaders`.
- Pairs well with `mobius-silent-api-failure`: a 401 wrapped in a 200 response body (some APIs do this) needs that skill's technique instead of a status-code check.
