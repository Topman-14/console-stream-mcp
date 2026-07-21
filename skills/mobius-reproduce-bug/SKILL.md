---
name: mobius-document-reproduced-bug
description: Turn a live, reproduced bug into a write-up — screenshot, DOM snapshot, console/network timeline, HAR — suitable for a GitHub issue or handoff, for when the fix isn't obvious in the moment. Offers to save it as a Markdown file with the screenshot embedded. Use once a repro is confirmed but needs to be filed or escalated, via mobius-mcp.
---

# mobius-document-reproduced-bug

Not every bug gets fixed on the spot — sometimes the right outcome of a debugging session is a well-documented issue, not a patch. Manually collecting a screenshot, the console output, and the network detail by hand is exactly the copy-paste tedium mobius-mcp exists to remove; this skill turns a live repro directly into something postable.

## When to use this

- A bug is confirmed reproducible but the root cause isn't clear yet, or fixing it is out of scope for this session.
- Handing a bug off to someone else, or filing it for later.
- The user asks to "write this up," "document this," or "file an issue" for something just reproduced.

## Workflow

1. `clear_logs`, then `start_debug_session(capture: ["console", "network", "navigation", "dom"])`.
2. Reproduce the bug — ask the user to walk through it, or drive it yourself via `navigate_to`/`evaluate_js`/`wait_for_element` if it's scriptable.
3. At the moment of failure, `take_screenshot` (or `capture_full_page` if the relevant part is off-screen). Skip this if the tab lacks CDP (npm client only) — note the gap rather than blocking on it.
4. `end_debug_session` for the ordered timeline.
5. `export_har` for a portable network record (headers + status text, no bodies — pair with the specific failing request's `responseBody` from the timeline if it's relevant).
6. **Ask the user before writing anything to disk:** confirm whether they want this saved as a Markdown file (and where — default to something like `bug-reports/<short-slug>.md` in the project unless they say otherwise), or whether a plain chat summary is enough. Don't assume — some sessions just want the summary read back, not a file created.
7. If they want a file:
   - Decode the screenshot's `dataBase64` to a real PNG file next to the Markdown (e.g. `<slug>-screenshot.png`) — the Write tool only writes text, so pipe the base64 through a decode step (`base64 -d`) rather than pasting the data URI inline; a raw base64 blob in the Markdown would bloat the file and most renderers (including GitHub) don't reliably inline it anyway.
   - Reference it from the Markdown with a normal relative image link: `![screenshot](./<slug>-screenshot.png)`.
   - Structure the file with: title, repro steps (numbered, written so someone else can follow them), the screenshot, the relevant timeline entries (trimmed — see below), the failing request(s) with status/headers/body fragment, and environment info (tab URL, relevant `get_connected_tabs` detail).
8. If just a summary is wanted, give the same structure as chat output, screenshot described instead of embedded.
9. If filing directly to GitHub is in scope for this session, offer that as a further option once the write-up exists — don't create the file *and* open the issue without checking which (or both) the user actually wants.

## Notes

- Curate aggressively regardless of output format. A dozen carefully chosen lines beats a raw JSON export — the point is to save the *next* person a repro, not to prove you captured everything.
- Never silently write files — this skill's whole first-run behavior is asking, not assuming.
