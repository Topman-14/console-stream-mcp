# Brief: make mobius-mcp self-diagnosing and discoverable

> Written 2026-07-22 from a Claude Code (Opus 4.8) session in an unrelated project
> (`~/Dev/alati-sln`). Evidence is drawn from this repo plus Claude Code's own state
> files. Line references were accurate at the time of writing.

## 0. Where this came from

The session was instructed to prefer mobius-mcp for browser work. It couldn't — and worse,
it couldn't tell the user *why* or what to fix. It fell back to Claude in Chrome and gave a
confidently wrong diagnosis ("the server fails to start").

## 1. What actually happened

- mobius-mcp is registered globally in `~/.claude.json` as `npx -y mobius-mcp`.
- One session connected fine. From
  `~/Library/Caches/claude-cli-nodejs/-Users-mac-Dev-alati-sln/mcp-logs-mobius-mcp/<ts>.jsonl`:
  - `Server stderr: [mobius-mcp] WebSocket server listening on ws://localhost:7331`
  - `Successfully connected (transport: stdio) in 750ms`
  - `capabilities: {"hasTools":true,"hasPrompts":false,"hasResources":false,"serverVersion":{"name":"mobius-mcp","version":"1.0.0"}}`
  - `Channel notifications skipped: server did not declare claude/channel capability`
- The **next** session produced no log entry at all — the server was never started, so zero
  mobius tools existed. The agent had no way to detect this: a tool that doesn't exist can't
  report anything.
- The agent then probed manually with `printf '{...initialize...}' | npx -y mobius-mcp`, got no
  reply, and declared the server broken. The *probe* was broken (stdin closed immediately). A
  one-shot health check would have prevented the false diagnosis.

Two takeaways: the server must be diagnosable **from outside an MCP session**, and everything it
knows about why it can't help must be in **tool output**, not stderr.

## 2. Problem A — the server can't tell the user what to fix

The entire "not usable" surface is two strings:

- `apps/mcp-server/src/utils/tools.ts:21` — `"No tabs connected. Ask the user to click the
  mobius-mcp extension icon and enable capture on the tab they want debugged."`
- `apps/mcp-server/src/transports/mcpServer.ts:163` — `"No extension connected. list_tabs
  requires the mobius-mcp extension to be enabled on at least one tab."`

`resolveTabId` emits the first whenever `registry.list()` is empty. That one condition collapses
five distinct situations:

| Real situation | What the user must do | Current message |
| --- | --- | --- |
| Extension never installed | Install it | "click the extension icon…" — there is no icon |
| Installed but disabled | Enable in `chrome://extensions` | same |
| Enabled, no tab opted in | Click icon, toggle capture | same (correct by luck) |
| Tab was enabled, WS dropped | Reload the tab | same (misleading) |
| Port mismatch / stale server | Check `MOBIUS_WS_PORT`, restart | same (misleading) |

`registry.ts` can't distinguish them today: it holds only *currently registered* clients, and
`markDisconnected` purges after `CLIENT_PURGE_DELAY_MS`, leaving no trace.

**A1. Retain the evidence.** In `wsServer.ts`/`registry.ts`, keep process-lifetime state that
survives purge: `everConnected`, `lastClientSeenAt`, `lastDisconnectReason`, a count of raw WS
connections that opened but failed the `hello`/protocol-version handshake (this separates
"extension present but version-mismatched" from "nothing ever connected"), and the resolved WS
port plus whether `listen` succeeded.

**A2. Add a `mobius_diagnose` tool.** It must never fail, never require a tab, and return a
machine-readable state plus ordered remediation:

```json
{
  "state": "no_client_ever_connected",
  "wsPort": 7331, "wsListening": true,
  "serverVersion": "1.0.1", "protocolVersion": 3,
  "clients": [], "everConnected": false, "rejectedHandshakes": 0,
  "remediation": [
    { "step": "Confirm the extension is installed at chrome://extensions", "userAction": true },
    { "step": "Click the mobius-mcp toolbar icon on the target tab and toggle capture on", "userAction": true },
    { "step": "Reload the tab after enabling", "userAction": true }
  ],
  "agentGuidance": "Do not retry other mobius tools until state=ready. Relay remediation to the user verbatim and stop."
}
```

**A3. Point every other failure at it.** Replace the `resolveTabId` string with a structured
error carrying the same `state` and a one-line "call `mobius_diagnose`". Short — the agent needs
a next action, not a paragraph.

**A4. Ship an out-of-band check.** `npx mobius-mcp --health` printing the same JSON, exiting 0/1.
This is precisely what would have stopped the false "server is broken" conclusion. Put it in a
README troubleshooting section.

**A5. Never let `[]` be ambiguous.** `get_capture_settings` exists, which is right. Make the
empty-result path of `get_recent_logs`/`get_recent_errors`/`get_network_requests` inline the
relevant capture flag, so an agent seeing `[]` never has to guess whether the category was
simply off.

## 3. Problem B — why Claude in Chrome wins by default

Mostly not capability. Discovery and injected guidance.

1. **First-party default flag.** `~/.claude.json` has `claudeInChromeDefaultEnabled: true`.
   Nothing third-party matches this — treat it as a fixed handicap and win elsewhere.
2. **Injected server instructions.** Claude in Chrome ships an MCP `instructions` string that
   Claude Code injects verbatim into the system prompt under `# MCP Server Instructions` (batch
   your ToolSearch, call `tabs_context_mcp` first, never reuse tab IDs…). **mobius-mcp ships
   none** — `new McpServer({ name: "mobius-mcp", version: "1.0.0" })` at `mcpServer.ts:38` and
   `:391`, no `instructions` anywhere in `apps/mcp-server/src`. Highest-leverage fix in this
   document.
3. **A registered skill.** The session's skill list included a `claude-in-chrome` skill whose
   description ends "Always invoke BEFORE attempting to use any `mcp__claude-in-chrome__*`
   tools." The six `skills/` entries here aren't installed as Claude Code skills, so they were
   invisible. Ship as a plugin/marketplace entry, or document the install path.
4. **No prompts, no resources** (`hasPrompts:false, hasResources:false`). Both are discovery
   surfaces.
5. **Undeclared capability**: `did not declare claude/channel capability` — worth finding out
   what it unlocks.
6. **Version drift.** npm publishes `1.0.1`; the server self-reports `1.0.0`, hardcoded. Derive
   from `package.json` or version reporting keeps lying.

Suggested `instructions` — short, imperative, about *routing*:

```
mobius-mcp gives live access to a running web app: console, errors, network (with bodies),
navigation, DOM mutations, HAR export, CPU/memory profiles.

Use it whenever the question is "what is this app actually doing at runtime" — a failing
request, a pasted error, a slow page, a silent 200, state after a click.

Before the first mobius tool call in a session, call `mobius_diagnose`. If it does not report
state=ready, relay its `remediation` to the user and stop — do not silently fall back to another
browser tool, and do not retry.

Prefer `wait_for_*` over polling `get_logs_since`. Prefer `start_debug_session` over correlating
snapshots by hand.
```

## 4. Problem C — the real capability gap

Mobius is an **observability** tool; Claude in Chrome is a **driving** tool. They barely overlap,
and the task in that session ("did my CSS change render correctly?") needs driving.

CiC has, mobius has none of: input synthesis (click/double/triple/right-click, hover, drag, type,
keys, scroll); actionable element handles (`read_page`/`find` return `ref_N` ids that `computer`
clicks or scrolls to); `form_input`/`file_upload`/`upload_image`; `gif_creator`; `resize_window`;
`browser_batch` (N actions per round trip — large latency win); tab lifecycle on any permitted tab
with no per-tab opt-in.

Mobius has, CiC has none of: persisted rolling history and `get_logs_since` surviving restart;
blocking `wait_for_console_error|navigation|request|element`; `start_debug_session` ordered
timelines; `export_har` with full bodies; CPU/memory profiling; explicit capture settings.

**Decision required:** does mobius want to drive at all? If yes, the MVP is `click(selector|ref)`,
`type(selector, text)`, `scroll_to(selector)` plus an element-handle format from `capture_dom`. If
no — defensible, and it keeps the local-first observability story clean — then say so in the
`instructions` and README so agents route correctly instead of trying and failing.

Either way: `capture_dom` returns `{ html: string }` (`apps/browser-extension/src/background.ts:98`),
a raw serialization with nothing addressable. Even for pure observability, a pruned indexed
snapshot beats a full HTML dump for an agent.

## 5. "Is seeing elements the same as DOM mutations? Should mutations go?"

No, and no.

**How CiC sees elements:** `read_page`/`find` return a snapshot of the current page as a pruned,
indexed tree of interactive elements, each with a stable `ref_N` handle; `get_page_text` returns
text; `screenshot` gives pixels with coordinates. The agent acts on a `ref` or an (x,y). Spatial
and structural — "what is on the page now, and how do I touch it." A pull, on demand.

**What `dom.mutation` is:** a temporal stream from a `MutationObserver`
(`packages/capture-core/src/main.ts:284`) emitting
`{ mutationType, targetSelector, addedCount, removedCount }`, opt-in, session-only. A push, over
time — "what changed, and when."

Different questions; neither substitutes for the other. Mobius's actual analogue of
element-seeing is `capture_dom`/`capture_accessibility_tree`, not mutations.

**Should mutations be removed?** Not for redundancy — but judge them on merit, because the case is
currently weak. The payload is low-signal (a short selector and two counts rarely explain *why*
something broke). Nothing consumes it: `skills/mobius-dead-click/SKILL.md` — the one skill whose
entire question is "did the DOM change after the click?" — never references it. And it's the only
capture type gated behind a session, i.e. the most API surface for the least-used signal.

Recommendation: keep the capture, raise its signal, and **make the dead-click skill actually use
it** — that's the proof case. If it still isn't pulling weight afterwards, delete it. It costs a
`MutationObserver`, a wire-protocol event type, a session-scoped opt-in path, and a row in every
capability table. A feature no skill and no agent reaches for is worth more as a deletion.

## 6. Priority order

1. `instructions` on `McpServer` (§3.2) — smallest diff, largest behavioural change
2. `mobius_diagnose` + structured states (§2.A1–A3)
3. `--health` out-of-band check (§2.A4)
4. Version from `package.json` (§3.6)
5. Make `skills/` installable (§3.3)
6. Decide driving vs. observability, and write it down (§4)
7. Dead-click skill consumes `dom.mutation`, or remove it (§5)
