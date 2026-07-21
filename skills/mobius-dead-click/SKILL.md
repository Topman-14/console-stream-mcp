---
name: mobius-dead-click
description: Confirm whether a UI interaction that "did nothing" truly triggered no network call, DOM change, or console output — or whether it failed silently somewhere invisible, including an overlapping element blocking the click or a stopPropagation/preventDefault swallowing it. Use when a user reports a button/link/form that "doesn't work" with no visible error, via mobius-mcp.
---

# mobius-dead-click

Most "it doesn't work" reports come with nothing to grep for — no stack trace, no error message, just "I clicked it and nothing happened." That could mean the click handler never fired, ran and swallowed an exception, fired a request that silently failed, or fired a request that "succeeded" with an error-shaped body. Reading the source won't tell you which; watching the tab while it happens will.

## When to use this

- "The button/link/form doesn't do anything" with no console error reported.
- A feature that used to work now silently no-ops.
- Before assuming an interaction is a dead end worth digging through source for — confirm what actually happens first.

## Workflow

1. `get_connected_tabs` (or `set_active_tab` if multiple) to confirm the right tab is streaming.
2. `clear_logs` to isolate what happens next from prior noise.
3. `start_debug_session(capture: ["console", "network", "navigation", "dom"])`.
4. Trigger the interaction. If it's automatable, `evaluate_js` to dispatch the click/submit on the element (e.g. `document.querySelector(sel).click()`); otherwise ask the user to perform it, then give it a couple of seconds.
5. `end_debug_session` and read the timeline. Diagnose from what's present or missing:
   - **Nothing at all in the timeline** — the handler never ran, or ran but was blocked before doing anything observable. Narrow it down (see "Nothing fired: two specific causes" below) before assuming it's just a missing/stale selector.
   - **Console entries, no network** — client-side logic ran and stopped short of firing a request (validation blocked it, a thrown exception got swallowed by an empty `catch`, state updated but nothing downstream reacted).
   - **A network request fired and came back 200, but the UI still shows nothing changed** — this is very likely a silent API failure, not a frontend bug at all. Hand off to `mobius-silent-api-failure` and inspect `responseBody` for an error-shaped payload before looking at the frontend any further.
   - **A network request fired and failed outright** (`error`, or 4xx/5xx `status`) — a real error occurred, it just never reached the UI. Find the missing `.catch()`/error boundary.
6. Once you know which of the above it is, grep source for the handler/selector to find the specific gap (missing dispatch, swallowed catch, missing UI feedback).

## Nothing fired: two specific causes

When the timeline is completely empty, it's tempting to assume a stale selector and stop looking — but two other causes are common enough to check explicitly before concluding that:

**An invisible element is blocking the click.** A modal, tooltip, toast, or loading spinner left mounted with `position: absolute`/`fixed` and a higher stacking context; a full-screen overlay with `opacity: 0` but no `pointer-events: none`; or a sibling painted directly on top. `evaluate_js` this check:

```js
const el = document.querySelector(selector);
const r = el.getBoundingClientRect();
document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el
```

If that's `false`, whatever `elementFromPoint` actually returns is eating the click — `capture_dom` to see what it is, or `take_screenshot`/`capture_element` to see it visually (an invisible-but-present blocker is often obvious once you actually look at that exact spot, even though it made zero console noise). Also check `getComputedStyle(el).pointerEvents === "none"` and whether the element or an ancestor has a `disabled` attribute that's been styled to look enabled.

**Event propagation swallowed it.** A parent's `stopPropagation()` (or a capturing-phase listener, `{ capture: true }`) can eat the click before your target's own handler runs; `preventDefault()` on a wrapping element can suppress default behavior (form submit, link navigation) while looking like nothing happened at all. There's no CDP tool for listing bound listeners here (`evaluate_js` runs plain `Runtime.evaluate`, not the DevTools console's command-line API), so this one is a source grep, not a live check: look for `stopPropagation`/`preventDefault`/`capture: true` on anything between the clicked element and its intended handler — a wrapping `<Link>`/router component, a "click outside to close" listener on a modal, or a delegated click handler higher up the tree are the usual suspects.

## Notes

- Don't skip step 2 — without a clean baseline, "nothing happened" is ambiguous between "truly nothing" and "something happened but it's buried in unrelated noise."
- If the tab isn't connected yet, that's the actual blocker — ask the user to enable capture via the extension icon before doing anything else (see the main mobius-mcp tool descriptions for how tab connection works).
