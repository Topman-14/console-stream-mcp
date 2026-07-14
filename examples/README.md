# Examples

Example apps demonstrating `mobius-mcp` integration via the npm client and the browser extension.

## `spa-smoke-test`

A React + `react-router-dom` SPA built specifically to exercise every mobius-mcp capture path: a range of `console.log/info/warn/error` payload shapes (objects, arrays, circular refs, BigInt, long strings, PII-shaped strings for testing redaction), multiple ways to trigger uncaught errors and unhandled rejections, `fetch`/`XHR` requests covering 200/404/500/slow/network-failure/POST, route changes, param changes (`/users/:userId`), search-param changes (`?sort=...`), and DOM mutations (childList/attributes/characterData).

Scenarios are **extensible by design**: `src/scenarios/*.ts` each export a flat list of `{ id, label, description, run }` objects, grouped by category in `src/scenarios/index.ts`. Adding a new scenario is a one-line push to an array; adding a new category is a one-line addition to `scenarioGroups`. The `/scenarios` route renders whatever's registered there — nothing else needs touching.

```bash
cd examples/spa-smoke-test
npm install
npm run dev
```

Open the served URL, enable capture on the tab via the mobius-mcp extension (or wire `mobius-client` into a real app the same way), navigate between routes and click through `/scenarios`, then ask your agent to inspect the results via the MCP tools — including `get_capture_settings` to confirm what's actually being captured before assuming a missing event is a bug.
