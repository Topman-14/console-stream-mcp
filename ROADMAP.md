# Roadmap

mobius-mcp started as a log bridge. The direction is a **browser runtime service**: a server an agent can command, not just read from — synchronous tools answer questions about existing state, asynchronous ones (backed by a shared job system) initiate work that takes time.

Stages A–F built the observability half of that. Stages G onward build the other half: **driving**. The target user is an agent in an ecosystem with no first-party browser agent — Cursor, Windsurf, Zed, Cline, Codex, OpenCode, or Claude Code on a machine without the Claude in Chrome extension — for whom "look at the running app" currently means "ask the human to paste something."

Stage F was the last stage that could ship server-only. Everything from Stage H on touches `packages/capture-core`'s wire protocol and the extension together, so `PROTOCOL_VERSION` moves with it.

Nothing here is published yet, so none of this is versioned (`v1`/`v2`/...) — it's tracked as build stages instead. Version numbers start once something actually ships.

**npm client status: paused.** `mobius-client` works at its current baseline (console/error/network capture via `startMobiusStream()`), but isn't getting further investment right now — framework/bundler nuances (Vite/webpack HMR re-invoking the patch, Next.js SSR/RSC boundary, React StrictMode double-invoke) make it a deeper problem than the extension warrants prioritizing today. The extension is where new capability work lands; the npm client will catch up once that's mature.

## Stage A — per-tab identity, memory bounds, opt-in capture (done)

- Per-tab identity: one background worker multiplexes many tabs over one WebSocket, but each tab is its own logical client (`hello`/`bye` per tab, not per browser install)
- Per-tab in-memory ring buffers (not one global buffer) with a shared cross-tab `seq` counter, field-length truncation, disconnect grace period before purge
- Tool disambiguation: `tabId` param on all query tools, auto-resolved when only one tab is connected, `set_active_tab` for session-scoped default, explicit error (not silent guessing) when multiple tabs are connected and unspecified
- Extension capture is opt-in per tab: a popup toggle (click the icon) is the single opt-in; an options page lets hostname/port rules auto-enable specific dev servers without a manual click. Nothing is captured by default.

## Stage B — command infrastructure (done)

The browser client becomes a remote-debugging target (Chrome DevTools ⇄ Chrome), not just a one-way log producer.

- Message envelope gains `kind: "command"` / `"ack"` variants with correlation IDs
- `ClientInfo`/`hello` gains `capabilities` (`["cdp"]` for the extension, `[]` for the npm client) — commands a client can't support fail clearly instead of hanging
- Job system (`startJob`/`get_job_status`/`get_job_result`/`cancel_job`) — the shared primitive every async capability after this stage is built on
- Browser-control tools needing no CDP: `navigate_to`, `list_tabs`, `switch_tab`, `reload_tab`

## Stage C — debug sessions (done)

The highest-leverage capability beyond raw ingestion, and cheap once the job system exists — aggregates event streams into one time-ordered timeline instead of forcing the agent to correlate separate snapshots itself.

- `start_debug_session({ tabId, capture: [...] })` / `end_debug_session(sessionId)` → ordered timeline (console, network, navigation, DOM mutations); single-tab sessions only for now
- New always-on `navigation` event type; `dom.mutation` event type, captured only during a session that requests it (mutation observers are noisy/expensive to run always-on)
- `wait_for_*` tools built on the same infrastructure: `wait_for_console_error`, `wait_for_navigation`, `wait_for_request` (server-side, event-driven), `wait_for_element` (in-page polling via a command)

## Stage D — CDP-backed capture (extension-only) (done)

Everything here requires `chrome.debugger` (Chrome DevTools Protocol) — gated by the `capabilities` check from Stage B, unavailable to npm-client-only tabs. Attaching shows Chrome's "being debugged" banner on the tab; the debugger attaches once per tab (not per call) and stays attached while the tab is capture-enabled.

- Screenshots: `take_screenshot`, `capture_full_page`, `capture_element`
- DOM/accessibility: `capture_dom`, `capture_accessibility_tree`
- Performance: `start_cpu_profile`, `start_memory_profile` — job-based, capped at 60s and best-effort beyond ~25-30s since an idle MV3 background service worker can be terminated by Chrome mid-profile
- Runtime evaluation: `evaluate_js` — fully open, no read-only enforcement (local-first threat model: it's the dev's own browser and app)
- Network detail: `get_response_body` (URL-keyed, best-effort — only requests seen via CDP's `Network.responseReceived` while attached), `export_har` (works from stored events for either client; full-body export landed later, see Stage F)

## Stage E — network request/response detail (done)

Closes the biggest network-capture gap: `NetworkEvent` used to carry only method/URL/status/duration and request headers, so an agent chasing a failed API call had to fall back to the CDP-only `get_response_body` (extension-only, and it didn't cover request bodies at all).

- `NetworkEvent` gained `responseHeaders`, `statusText`, `mimeType`, and size-capped (~20,000 chars) `requestBody`/`responseBody` with `*Truncated`/`*OmittedReason` fields — captured in `packages/capture-core` (shared by the extension and the paused npm client) via the existing `fetch`/XHR patches, not CDP, so both clients get it identically
- Response bodies are read from a `.clone()` *after* the response is already returned to the caller's own code, so this never adds latency to the app's own `fetch` calls — the single `network.fetch`/`network.xhr` event for that request is emitted once the body read (or the decision to skip it) resolves, not before
- Content-type gated (text/JSON/XML/form/GraphQL only) and redacted before emit — a new `redactSensitiveBodyFields` privacy toggle masks password/token/secret/apiKey-shaped JSON keys, independent of header redaction
- `export_har` and `get_network_requests`/`get_logs_since` now carry real headers and status text; `get_response_body` is reframed as the CDP fallback for bodies capture-core skipped (binary, oversized, non-text content-type), not the primary path
- Privacy options simplified alongside this: the old `redactHeaders`/`redactCookies` pair (redundant — cookies were always just header names) became one configurable `redactedHeaderNames` list, editable in the options page. The never-implemented `redactLocalStorage` option was removed rather than shipped as dead UI — see "Framework introspection" below for the tracked future work it belonged to.

## Stage F — mcp-server persistence & cleanup (done)

Closes half of the "durable log persistence" gap tracked under "Beyond this plan" below (server side only — the extension's own durable store is still open, see below) and restructures `apps/mcp-server/src` now that it had grown past a flat file-per-concern layout.

- `get_request_body` — the request-side counterpart to `get_response_body`, same CDP fallback semantics (URL-keyed, best-effort, extension-only)
- `export_har` now exports full request/response bodies, not headers-only: bodies already captured inline are used as-is, anything `*Truncated` or skipped (binary, oversized, non-text content-type) is re-fetched over CDP when the tab supports it, with binary bodies coming back base64-encoded in `content.encoding` per the HAR 1.2 spec
- **Crash/restart durability**: `EventStore`'s ring buffer is now mirrored to an append-only JSONL file per tab (`services/persistence.ts`), replayed into memory on boot, and reaped on an interval. Configurable via `CONSOLE_STREAM_PERSISTENCE_TTL_MS` (default 1 hour) and `CONSOLE_STREAM_PERSISTENCE_DIR` (default a temp-dir subfolder) — see `README.md`'s Configuration section. Deliberately plain files over an embedded database: the capped working set (event count × field-length cap) never exceeds a few MB, so there's no query-performance case for SQLite, and `better-sqlite3` (native, prebuilt-binary install risk) vs. `node:sqlite` (unsupported before Node 22.5, below this package's `"engines": ">=18"` floor) both cost more than they'd buy here.
- `MAX_EVENTS_PER_TAB` default raised from 1000 to 3000 events/tab now that history survives a restart instead of being purely disposable — same cap governs both the in-memory buffer and the on-disk file
- Structural cleanup: `apps/mcp-server/src` split into `types.ts`/`data.ts` (mirroring `packages/capture-core`'s layout), a `utils/` folder of pure helpers grouped by what they operate on (`events`, `wait-for`, `har`, `tools`, `errors`), a `services/` folder for the stateful singletons `index.ts` instantiates (`store`, `registry`, `commandDispatcher`, `jobs`, `debugSession`, `controlClient`, `persistence`), and a `transports/` folder for the two protocol-facing servers (`wsServer`, `mcpServer`). The repeated per-tool `resolveTabId`/`requireCdp`/try-catch boilerplate in `mcpServer.ts` collapsed into shared helpers (`resolveCdpTab`, `runCommand`) in `utils/tools.ts`.

## Decisions taken before Stage G

Recorded here because the stages below only make sense if these are settled. Source: `AGENT_INTEGRATION_BRIEF.md`, written from an outside session that tried to use this server and couldn't.

**Does mobius drive, or stay pure observability?** It drives. The brief framed this as an open question with a defensible "no" — that "no" is rejected. The reason isn't feature parity for its own sake: it's that the questions mobius is best at ("why did this request fail", "what errored after that click") mostly can't be *reached* without first getting the app into the state where they happen. An observability tool that needs a human to click the button before it can answer anything is a tool the agent routes around. Everything in Stages H–J follows from this.

**What mobius sells that a first-party browser agent doesn't.** Not input synthesis — that's table stakes and we're late to it. It's that mobius drives and observes over *the same connection*, so an action can return what it caused. Clicking and then separately asking "what happened" is two round trips and a correlation problem; `click(ref, { observe: ... })` returning the console errors, requests, navigations and DOM changes inside that action's window is one round trip and no correlation. That, plus the things Stages A–F already built and no browser agent has (rolling history that survives a restart, blocking `wait_for_*`, `export_har` with full bodies, CPU/memory profiles), is the pitch. Stage I is where it lands, and it should be built *as* the differentiator, not bolted on after the actions work.

**Is `dom.mutation` pulling its weight?** Not today — the brief is right that the payload is low-signal and nothing consumes it. But it's kept, because driving changes the calculus: once an action has an observation window, "did anything in the DOM change" is the exact signal that separates a dead click from a slow one. Stage I raises its signal and makes it the default DOM channel of the observe window; Stage K re-decides with evidence. If it still isn't reached for after that, it gets deleted.

**Does `capture_dom` survive?** Yes, demoted. Raw `outerHTML` is occasionally the right answer (diffing markup, checking a server-rendered payload), but it's the wrong default for an agent — Stage H makes `snapshot_page` the thing tool descriptions point at, and rewrites `capture_dom`'s description to say when *not* to use it.

## Stage G — routing and self-diagnosis (next)

Entirely `apps/mcp-server`. No protocol change, no extension change, no new capability — this stage exists because the capability that already exists is undiscoverable and, when it doesn't work, undiagnosable. An outside session with mobius registered globally couldn't use it, couldn't tell the user why, fell back to another tool, and reported a confidently wrong cause ("the server fails to start" — the server was fine; the probe was malformed). Smallest diff in this document, largest behavioural change, and it should ship before any of the driving work so that driving work is actually reachable.

Ordered by leverage-per-line, which is roughly reverse order of effort.

**G1. `instructions` on `McpServer`** (~20 lines, one file). `new McpServer({ name, version })` in `transports/mcpServer.ts` takes an `instructions` string that MCP clients inject verbatim into the system prompt. Claude in Chrome ships one; mobius ships none, which is most of why an agent holding both reaches for the other. Content is about *routing*, not tool reference — when this server is the right answer, the mandatory `mobius_diagnose` preflight, and "do not silently fall back to another browser tool." Must be set on the follower server too (`createFollowerMcpServer`), or half the sessions on a machine get no instructions.

**G2. Version from `package.json`** (~5 lines). Three sources disagree today: `package.json` is `1.0.1`, both `McpServer` constructors hardcode `1.0.0`, and `HAR_CREATOR_VERSION` in `data.ts` says `0.0.1`. Read it once via `createRequire(import.meta.url)("../package.json")` into a `VERSION` const in `data.ts` and use it in all three places — `createRequire` over a tsup `define` because it works unchanged when running from source (`npm run start -w apps/mcp-server`), which the build-time constant wouldn't.

**G3. Retain disconnection evidence** (`services/registry.ts`, `transports/wsServer.ts`). `ClientRegistry` holds only currently-registered clients and `markDisconnected` purges after `CLIENT_PURGE_DELAY_MS`, so five distinct situations collapse into one empty `list()`. Add process-lifetime state that survives purge: `everConnected`, `lastClientSeenAt`, `lastDisconnectReason`, the resolved WS port and whether `listen` succeeded, and — separately — a count of raw WS connections that opened but never completed a valid `hello`. That last one is what distinguishes "extension installed but version-mismatched" from "nothing has ever connected," and `wsServer.ts` currently throws that information away twice: the `isProtocolVersionSupported` branch closes with code 4000 and returns, and a socket that opens and closes without ever sending `hello` leaves no trace at all.

**G4. `mobius_diagnose`** (~120 lines, new `services/diagnostics.ts` + one tool). Never fails, never requires a tab, always returns a machine-readable `state` plus ordered remediation. States: `ready`, `no_client_ever_connected`, `client_disconnected`, `handshake_rejected`, `follower_hub_unreachable`, `ws_bind_failed`. Each maps to a fixed remediation list — the point is that "install the extension," "toggle capture on the tab," "reload the tab after enabling," and "check `CONSOLE_STREAM_PORT`" are four different instructions and today's single string is only correct for one of them. Include `agentGuidance` telling the agent to relay remediation and stop rather than retry or fall back.

**G5. Point every failure at it** (`utils/tools.ts`, `transports/mcpServer.ts`). Replace `resolveTabId`'s string and `list_tabs`'s string with structured errors carrying the same `state` and one line: call `mobius_diagnose`. Short — the agent needs a next action, not a paragraph.

**G6. `--health`** (~40 lines, `index.ts`). `npx mobius-mcp --health` prints the `mobius_diagnose` payload as JSON and exits 0 when `state === "ready"`, 1 otherwise. Out-of-band, so it works when there is no MCP session — which is exactly the case that produced the false diagnosis. Implementation is a WS client probe, not a second server: connection refused means no hub is running; connected means send a `control-request` for `mobius_diagnose` and print the hub's answer. Reuses the follower channel wholesale (`services/controlClient.ts`), so this is nearly free. Needs a README troubleshooting section, or nobody runs it.

**G7. Never let `[]` be ambiguous** (`transports/mcpServer.ts`). `get_capture_settings` exists and is the right idea, but it's a tool an agent has to know to call. Make the *empty*-result path of `get_recent_logs`/`get_recent_errors`/`get_network_requests` inline the relevant capture flag, so `[]` is never a guess between "nothing happened" and "that category is off."

**G8. Ship `skills/` as installable** (repo root). The six skills here aren't registered as Claude Code skills, so they're invisible to exactly the sessions they were written for — an agent with a `claude-in-chrome` skill in its list and nothing from mobius routes to Chrome. Add a plugin manifest and marketplace entry, and document the install path in the README.

**G9. Prompts and resources** (`transports/mcpServer.ts`). The server reports `hasPrompts:false, hasResources:false`; both are discovery surfaces sitting unused. Resources: `mobius://status` (the diagnose payload as a readable resource), `mobius://tabs` (connected tabs). Prompts: one per shipped skill, so the scenario workflows are reachable from clients that surface prompts but don't support skills at all — which is most of the non-Claude-Code ecosystem this pivot targets.

**G10. Spike: `claude/channel`** (timeboxed, no deliverable committed). Claude Code logs `Channel notifications skipped: server did not declare claude/channel capability` on every connect. What it unlocks is not documented anywhere we've checked, and it may be Claude-Code-specific enough to be a poor fit for a cross-ecosystem server. Find out what it is before deciding whether it's worth declaring; do not build against it on the assumption that it's useful.

## Stage H — element handles and the page snapshot

The prerequisite for everything in Stage I, and the reason input synthesis can't just be "add some CDP calls." CDP's `Input.dispatchMouseEvent` takes viewport coordinates, so *something* has to turn "the Save button" into an (x, y) — and an agent that can only address elements by CSS selector is guessing at markup it hasn't seen. Today the only way to see the page is `capture_dom`, which returns `{ html: string }` (`background.ts:98`): a full raw serialization, enormous on a real app, with nothing in it the agent can act on.

- **`snapshot_page`** → a pruned, indexed tree of the elements that matter (interactive, labelled, or text-bearing), each carrying a stable-within-snapshot `ref`, its role, its accessible name, and its box. Plus the snapshot id and the page URL/title.
- **In-page DOM walk, not `Accessibility.getFullAXTree`.** The AX tree is more semantically honest and it's what a first-party browser agent uses, but it hands back `backendDOMNodeId`s that each need a `DOM.resolveNode` + `DOM.getBoxModel` round trip to become coordinates — chatty enough to matter on a page with a few hundred nodes. A single `Runtime.evaluate` running a walk in the page returns the tree *and* every `getBoundingClientRect()` in one call, and gets `checkVisibility()` for free to prune the offscreen/hidden majority. Layer accessible-name computation into the walk rather than switching source; keep `capture_accessibility_tree` as the escape hatch for when the real AX tree is the question.
- **Ref lifetime is explicit and short.** Refs are snapshot-scoped (`ref_12@snap_3`), resolved through a page-side registry held by the already-injected MAIN-world script. An action against a superseded snapshot fails with a `stale_snapshot` error naming the fix ("call `snapshot_page` again"), rather than silently acting on whatever now occupies that index. Pretending refs are durable across a re-render is the failure mode worth designing out from the start.
- **Every action tool accepts `ref | selector`.** Selectors keep working — they're better when the agent already knows the markup from source — but refs are what the snapshot hands out and what the tool descriptions lead with.
- `capture_dom` stays, description rewritten to say it's for raw-markup questions, not for finding something to click.
- Protocol: new `snapshot_page` command, new `PageSnapshot` type in `packages/capture-core/src/types.ts`, `PROTOCOL_VERSION` bump.

## Stage I — input synthesis and instrumented actions

The stage the pivot is actually about. Two halves that ship together, because half of it is commodity and the other half is the reason to use this server at all.

**I1. The actions.** All via CDP `Input.*` through the existing `sendCdp` helper — real trusted events, not `element.click()`, which doesn't reproduce what a user does and misses whole classes of handler.

- `click({ ref | selector, button, clickCount, modifiers })` — covers double/triple/right-click through `clickCount`/`button` rather than four tools
- `hover({ ref | selector })`
- `type_text({ ref | selector, text, clear })` — `Input.insertText` for speed, with a `perKey` escape hatch dispatching real `keydown`/`keyup` for widgets that listen for keys rather than input events
- `press_key({ key, modifiers })`
- `scroll_to({ ref | selector })` / `scroll_by({ dx, dy })`
- `select_option({ ref | selector, value })`, `set_checkbox({ ref | selector, checked })` — form semantics that are fiddly and error-prone to express as raw clicks
- Deferred to Stage J: `drag`, file upload, viewport resize

**I2. Instrumented actions.** Every action tool takes an optional `observe: { windowMs, types }` and returns, alongside the action's own result, the events that landed in the store between the action dispatching and the window closing — correlated by `seq` range, which the store already gives us for free. So `click(ref, { observe: { windowMs: 1500 } })` answers "did that button do anything" in one call: the console errors it threw, the requests it fired and their status, whether it navigated, whether the DOM changed. This is the whole differentiator; it should be in the tool descriptions and in `instructions` as the *default* way to act, with bare actions as the exception.

**I3. `run_sequence([...actions])`.** N actions in one round trip, each with its own optional observe window, stopping at the first failure and returning what completed. On a multi-step flow the latency difference against one-call-per-action is large, and it composes with I2 into "here is the flow, here is everything the app did during it" — which is a debugging transcript, not a click log.

**I4. `dom.mutation` earns its keep or doesn't.** Raise its signal (`attributeName` and `oldValue` for attribute/characterData changes, a short text preview of added nodes, burst coalescing so one React re-render isn't forty events), make it the DOM channel of the observe window, and rewrite `skills/mobius-dead-click` to actually consume it — that skill's entire question is "did the DOM change after the click?" and it currently never references the event type that answers it. That's the proof case. Verdict in Stage K.

## Stage J — attach anywhere, and the rest of the parity list

Stage I makes mobius able to drive. This stage makes driving not annoying.

- **`attach_tab({ tabId })` / `open_tab({ url })`.** The sharpest remaining friction: capture is opt-in per tab via a popup click, which is a reasonable privacy default for passive capture and a genuine obstacle for driving — an agent that can drive but must ask a human to click an icon before every session has not removed the human from the loop. Both tools let the *server* initiate enablement, gated on the origin already holding host permission (granted once by the user, via `<all_urls>` or a rule in the options page) — so consent still comes from the human, just not per tab. `open_tab` additionally auto-enables the tab it creates, which is the clean path for a flow that starts from nothing.
- **`upload_file({ ref | selector, path })`** via CDP `DOM.setFileInputFiles`, which takes host filesystem paths — workable precisely because server and browser are the same machine, which is also why it needs a deliberate look at what an agent should be allowed to hand the page.
- **`resize_viewport({ width, height, deviceScaleFactor })`** via `Emulation.setDeviceMetricsOverride` — responsive-layout checking, and the thing that makes screenshots reproducible across machines.
- **Recording.** A job-backed screenshot sequence over an interval or a `run_sequence`, encoded to GIF. Useful for handing a repro to a human, and the natural output of `skills/mobius-reproduce-bug`. Lower priority than everything above it: it's for humans reading the result, not for the agent solving the problem.

## Stage K — pruning

Deliberately last, and deliberately about deletion. After Stages G–J have been used on real work:

- `dom.mutation` verdict (see I4). Kept only if the dead-click skill and the observe window actually reach for it. Otherwise deleted — it costs a `MutationObserver`, a wire event type, a session-scoped opt-in path, and a row in every capability table.
- Tool-surface audit. Stage I roughly doubles the tool count, and a large tool list is itself a routing cost for the agent — anything the shipped skills never call is a candidate for merging into a neighbour or removing.
- `capture_dom` vs `snapshot_page` vs `capture_accessibility_tree`: three ways to see a page is at least one too many. Decide with usage data rather than up front.

## Beyond this plan

- Framework introspection: React/Redux/Zustand state, storage inspection (cookies/localStorage/IndexedDB), source map resolution, Next.js overlay/Vite HMR errors
- Multi-tab debug sessions
- **Richer event context.** Today's console/error events are captured close to raw — enough to see *what* happened, not always enough to see *why* without a follow-up round trip the agent has to know to make. Network detail is covered by Stage E now; what's left:
  - Console/errors: attach a resolved stack trace (source-mapped where a map is available) instead of just `message`, and group related entries — e.g. a `console.error` immediately followed by an `unhandledrejection` from the same call, or repeated identical logs collapsed with a count instead of N separate feed entries
  - Network: the initiator (which script/line triggered the request) still isn't captured; surface CORS/mixed-content/blocked-request failures as a distinct reason instead of `status: undefined`
  - Keep this opt-in/tunable via capture settings — richer payloads mean more captured data (bigger privacy footprint, same as the durable-persistence question below) and more noise on busy pages, so it shouldn't be forced on by default
- npm client hardening (once unpaused): HMR-safe re-invocation guard, documented SSR/client-only usage, StrictMode-safe teardown
- **Durable log persistence — extension side.** The server half of this shipped in Stage F (JSONL files, TTL-pruned, see above). Still open: the extension's `chrome.storage.session`-backed live state (`apps/browser-extension/src/lib/live-state.ts`) survives service-worker idle-restarts but is wiped on extension reload/disable/browser close, and deliberately clears a tab's feed on `chrome.tabs.onRemoved`.
  - Back it with **IndexedDB**, not `chrome.storage.local` — `storage.local` JSON-serializes the whole value per key per write (O(n) rewrite as an array grows), a poor fit for high-frequency small appends; IndexedDB gives real indexes (`seq` autoincrement PK, index on `clientId`, index on `type`), is async/off-thread, and has a disk-based quota. Keep `chrome.storage.session` as-is for the popup's live counters/feed (small, capped, fast render path) — IndexedDB is the backing store for history/cursor queries, not what re-renders the UI. Batch writes (flush every ~250ms or 50 events per transaction, not one `put()` per event), prune via an `IDBKeyRange` delete on a timestamp index in the same flush cycle. Redaction still happens upstream in `capture-core` before an event leaves the page — the persistence layer doesn't need its own pass.
  - Open questions before implementing: retention window (mirror the server's configurable TTL, or fix one?), and whether persistence is opt-in (captured logs can contain request bodies/headers even with redaction on, so durable-by-default has a bigger privacy footprint than today's wipe-on-restart behavior — the server side defaults *on* with a 1-hour TTL, which may or may not be the right call to mirror here).

## Skills (done)

`skill/SKILL.md` used to be one comprehensive skill covering every tool this server exposes — as the tool surface grew (Stage D's CDP tools, then Stage E's network detail), that meant loading a lot of generic tool-reference instruction regardless of what the agent actually needed for a given session. Split into six scenario-focused skills under `skills/<name>/SKILL.md`, matching the vendored-skill layout already used elsewhere in this repo's dev tooling (see `skills-lock.json`), so each is independently indexable.

The initial split-up sketch here was one skill per tool *category* (network debugging, console debugging, visual debugging, ...) — reworked before building, since that's really just the tool list restated with extra steps. What shipped instead targets specific bug classes that are hard to catch by reading source alone, several of which only became tractable once Stage E added response bodies:

- `mobius-dead-click` — a button/link/form that "does nothing," disambiguated into: handler never fired, ran and failed silently, or hit a silent API failure
- `mobius-silent-api-failure` — an API returning `200 OK` with an error-shaped body (`success: false`, a GraphQL `errors` array) — a blind spot for anything checking status codes alone, only inspectable now that `responseBody` is captured
- `mobius-contract-drift` — a live response whose JSON shape no longer matches the TypeScript type the frontend expects (the classic "backend renamed a field, frontend types didn't follow" bug)
- `mobius-reproduce-bug` — turns a confirmed-but-unsolved repro into a screenshot + timeline + HAR write-up suitable for filing or handoff, asking first whether to save it as a Markdown file (screenshot embedded as a sibling image, not inlined as base64) or just summarize in chat
- `mobius-perf-stakeout` — isolates a vague "feels slow" report into network-bound, CPU-bound, or a memory leak building up over repeated use, using request timing + `start_cpu_profile`/`start_memory_profile` together rather than guessing which one to reach for
- `mobius-session-drift` — a silently dropped auth/session mid-flow, found by diffing `requestHeaders` presence across a request sequence (works even with header values redacted, since only the value is masked, not the key)

Left out on purpose: a dedicated "how to connect" skill. Every skill above states its own tab-connection prerequisite inline instead, since that's a one-line check, not a workflow worth a whole skill.
