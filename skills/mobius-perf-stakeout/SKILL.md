---
name: mobius-perf-stakeout
description: Diagnose "this feels slow" by isolating whether an interaction is network-bound, JS/CPU-bound, a memory leak, or a render loop/race condition from bad JS (React useEffect, framework reactivity bugs). Use for sluggishness or jank reports with no obvious cause, via mobius-mcp.
---

# mobius-perf-stakeout

"It feels slow" is vague on purpose — the user isn't wrong, but they can't tell you *why*, and network delay, JS-bound rendering, and a slowly growing memory leak all look identical from the outside while needing completely different fixes. Guessing which one it is wastes a round-trip; measuring takes one pass.

## When to use this

- A vague sluggishness/jank report with no error attached.
- "It gets slower the longer I use it" — a leak suspicion.
- Before proposing a performance fix, to confirm which layer actually owns the delay.

## Workflow

1. `get_connected_tabs` — CPU/memory profiling and this skill's later steps require the browser extension (CDP); confirm the tab has that capability first.
2. **Baseline (network):** `clear_logs`, perform the interaction once, then `get_network_requests` and check `durationMs` on anything involved. Two distinct signals live here, don't stop at just the slowest one:
   - **One request dominates the delay** — network-bound. Look at whether it's a genuinely slow backend, an oversized `responseBody`, or something that should've been cached/debounced/batched instead of re-fetched. Stop here.
   - **The same method+URL appears more than once, clustered within milliseconds of each other** — this is the network-visible fingerprint of a render loop, not organic traffic. Skip straight to step 4 instead of profiling first; a burst of identical requests is a much cheaper signal to spot than a CPU profile and points directly at the cause.
3. **If network is fine (one clean call, or none) but the UI still lags:** `start_cpu_profile(tabId, durationMs)` bracketing the interaction, poll `get_job_status` until done, then `get_job_result`. Look for the heaviest self-time frames — long tasks, expensive re-renders, layout thrashing. A single hot frame that's the same function called once is "this component is just expensive"; the *same* frame appearing many times in one short profile is actually a render loop too (see step 4) — profile output can surface the same bug the network burst check does, from the other side.
4. **Render loop or race condition (React `useEffect` and equivalent reactivity in other frameworks):** this is the same underlying bug family regardless of framework — something re-triggers work every render/update instead of once — so trace it the same way everywhere:
   - Confirm the pattern: repeated identical requests in step 2, or a CPU profile (step 3) dominated by the same function called repeatedly rather than one expensive call.
   - Grep the component/module for the reactive trigger: a `useEffect`/`useMemo`/`useCallback` whose dependency array is missing an entry (fires once then never stops re-syncing) or includes a **new reference every render** — an inline object/array/function literal, or a value derived without memoization — which re-fires on every render since referential equality never holds. Same idea in other frameworks: a Vue `watch`/computed with an over-broad source, a Svelte reactive statement (`$:`) depending on something that changes every tick, Angular change detection re-running a getter that allocates a new object each call.
   - Missing cleanup is a common companion bug, not just a symptom: an effect that starts a subscription/interval/listener without a cleanup function compounds across every re-run, which is often *why* the loop gets worse over time rather than settling.
5. **Race condition (stale response wins):** compare *when each request was sent* against *when its response was applied* — with `get_logs_since` or the debug-session timeline, if a request fired first but its response-bearing event lands *after* a later request's, and the UI reflects the earlier (slower) one's data, that's a classic unaborted-fetch race (rapid search-as-you-type, tab-switching, or any handler re-firing before the previous call resolved). Grep for the call site: no `AbortController`, no "is this still the latest request" guard, or a `useEffect` that doesn't cancel/ignore its previous in-flight call before firing a new one.
6. **If it gets worse the longer the session runs** *and* steps 4–5 don't explain it: drive the same interaction N times in a loop via `evaluate_js`, then `start_memory_profile` before and after the loop and compare heap growth via `get_job_result`. A heap that grows roughly linearly with identical repeated actions (rather than plateauing) points to a leak — unreleased event listeners, detached DOM nodes still referenced, or a cache/array that only ever grows.
7. Report which bucket it falls into with the specific evidence (the dominant request + its duration; the burst pattern + the offending effect/watcher; the heaviest frame; the heap delta per iteration) — not a raw profile dump.

## Notes

- CPU/memory profiles are best-effort beyond ~25–30s — an idle MV3 background service worker can be killed mid-profile. Prefer several short profiles (5–10s) bracketing the exact interaction over one long one.
- `start_cpu_profile`/`start_memory_profile` are job-based and asynchronous — always `get_job_status` before `get_job_result`, don't assume it's ready immediately.
- If the tab lacks CDP (npm client only), steps 3, 6 aren't available — network timing (step 2) and the request-burst/race-condition checks (steps 4–5) still work off captured events alone and may already be enough.
- Lead with the network-burst check (step 2) before reaching for a profile — it's free (already-captured data, no new capture needed) and catches the single most common cause of "feels slow" reports in practice: a loop re-fetching the same thing, not raw CPU cost.
