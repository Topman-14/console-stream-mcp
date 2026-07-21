---
name: mobius-contract-drift
description: Detect frontend/backend contract drift — a captured API response whose actual JSON shape no longer matches the TypeScript type the calling code expects (renamed, missing, or extra fields). Use after a backend change, or when data renders blank/undefined despite a successful request, via mobius-mcp.
---

# mobius-contract-drift

"The backend renamed a field, the frontend type wasn't updated" is one of the most common full-stack bugs, and it's invisible to both type-checking (an HTTP response is `unknown`/`any` until someone casts it) and status-code monitoring (still a clean 200). It's only visible by holding the *actual* response next to the *declared* type — which is tedious enough by hand that it rarely happens until something visibly breaks.

## When to use this

- Data renders as blank/`undefined`/`[object Object]` despite the network tab showing a successful request.
- Right after a backend/API change, to sanity-check nothing downstream silently broke.
- "This used to work" reports where the request still succeeds.

## Workflow

1. Reproduce the request in question (`get_network_requests` / `get_logs_since`), and pull its `responseBody` — parse it as JSON.
2. Find the call site: grep source for the `requestUrl` (or a distinctive path segment) to locate the `fetch`/`axios`/query-hook call.
3. Find the TypeScript type the response is cast to or destructured against near that call site — often a generic param (`useQuery<T>`), a `satisfies` clause, or an interface declared just above/below.
4. Diff field-by-field between the live `responseBody` and the type:
   - A field the type expects (`userId`) doesn't exist, but a differently-cased/named one does (`user_id`) — a rename.
   - A field the type marks required is `null` or absent in the live body — a backend behavior change or an unhandled edge case.
   - The type expects an array (`items: Item[]`) but the body nests it differently (`{ results: [...] }`) — a wrapper/pagination shape change.
5. Report the concrete mismatch with both sides shown side by side. This is usually a one-line fix (update the type, or add a small mapper) — the value here is finding it fast, not fixing it cleverly.

## Notes

- If the discrepancy might be intermittent (works sometimes), use `get_logs_since` across a wider window to compare multiple captures of the same endpoint rather than trusting a single sample.
- Large/truncated bodies (`responseBodyTruncated: true`) may hide the mismatched field past the cutoff — use `get_response_body` for the untruncated version if the diff looks inconclusive.
- Works in the other direction too: if the *request* body doesn't match what the backend's input type expects, the same technique applies to `requestBody`.
