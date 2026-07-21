import { useEffect, useState } from "react";
import { GearSix, Circle, Play, Pause, Stop, Bug, Trash, ArrowSquareOut, Infinity as InfinityIcon } from "@phosphor-icons/react";
import { useTheme } from "../../hooks/use-theme.js";
import { usePopupPort } from "../../hooks/use-popup-port.js";
import { useSyncedSetting } from "../../hooks/use-setting.js";
import { captureOptionsSetting } from "../../lib/capture-options.js";
import type { TabState } from "../../lib/tab-state.js";
import { getRules, setRules, findMatchingRule, ruleToOrigin, type CaptureRule } from "../../lib/rules.js";
import { requestOrigin } from "../../lib/host-permissions.js";
import { getRestrictedUrlReason } from "../../lib/restricted-url.js";
import { Button } from "../../components/ui/button.js";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { ScrollArea } from "../../components/ui/scroll-area.js";
import { Separator } from "../../components/ui/separator.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip.js";
import { cn } from "../../lib/utils.js";
import { WS_URL, REPO_URL, REPORT_BUG_URL, STATUS_LABEL, STATUS_DOT, COUNTER_ITEMS, KIND_DOT, KIND_TEXT, KIND_LABEL } from "./data.js";

function formatElapsed(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function Popup() {
  useTheme();

  const [tabId, setTabId] = useState<number | undefined>();
  const [tabUrl, setTabUrl] = useState<string | undefined>();
  const [host, setHost] = useState<string | undefined>();
  const [state, setState] = useState<TabState | null | undefined>(undefined);
  const [elapsed, setElapsed] = useState<string | undefined>();
  const [rules, setRulesState] = useState<CaptureRule[]>([]);
  const [ruleJustAdded, setRuleJustAdded] = useState(false);
  const [ruleDenied, setRuleDenied] = useState(false);
  const [captureOptions] = useSyncedSetting(captureOptionsSetting);

  useEffect(() => {
    getActiveTab().then(async (tab) => {
      setTabId(tab?.id);
      setTabUrl(tab?.url);
      setHost(hostOf(tab?.url));
      if (tab?.id === undefined) return;
      const { state } = await chrome.runtime.sendMessage({ type: "mobius-mcp/get-state", tabId: tab.id });
      setState(state);
    });
    getRules().then(setRulesState);
  }, []);

  const push = usePopupPort(tabId);
  const recordingStartedAt = push?.live.recordingStartedAt;

  useEffect(() => {
    if (!recordingStartedAt) {
      setElapsed(undefined);
      return;
    }
    setElapsed(formatElapsed(recordingStartedAt));
    const interval = setInterval(() => setElapsed(formatElapsed(recordingStartedAt)), 1000);
    return () => clearInterval(interval);
  }, [recordingStartedAt]);

  const start = async () => {
    if (tabId === undefined) return;
    const { state: next } = await chrome.runtime.sendMessage({ type: "mobius-mcp/toggle", tabId });
    setState(next);
  };

  const stop = async () => {
    if (tabId === undefined || !state) return;
    await chrome.runtime.sendMessage({ type: "mobius-mcp/toggle", tabId });
    setState(null);
  };

  const pause = async () => {
    if (tabId === undefined || !state) return;
    const { state: next } = await chrome.runtime.sendMessage({ type: "mobius-mcp/set-paused", tabId, paused: !state.paused });
    setState(next);
  };

  const clear = () => {
    if (tabId === undefined) return;
    chrome.runtime.sendMessage({ type: "mobius-mcp/clear", tabId });
  };

  const addCurrentHostRule = async () => {
    if (!host) return;
    setRuleDenied(false);
    const granted = await requestOrigin(ruleToOrigin(host));
    if (!granted) {
      setRuleDenied(true);
      return;
    }
    const rule: CaptureRule = { id: crypto.randomUUID(), pattern: host };
    const next = [...(await getRules()), rule];
    await setRules(next);
    setRulesState(next);
    setRuleJustAdded(true);
    // Rules only get evaluated on the *next* navigation (chrome.webNavigation.onCommitted
    // in background.ts) — enable this visit too so "auto-enable" also takes effect
    // immediately instead of only on the next page load.
    if (!state) await start();
  };

  const status = push?.connection.status ?? "disconnected";
  const counters = push?.live.counters ?? { console: 0, errors: 0, network: 0, runtime: 0 };
  const feed = push?.live.feed ?? [];
  const capturing = state && !state.paused;
  const autoEnabled = tabUrl ? Boolean(findMatchingRule(tabUrl, rules)) : true;
  const mcpDown = !push || push.connection.status !== "connected";
  const restrictedReason = getRestrictedUrlReason(tabUrl);

  return (
    <TooltipProvider>
    <div className="flex flex-col divide-y divide-border">
      {/* connection header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-none", STATUS_DOT[status])} />
          <InfinityIcon size={16} weight="bold" className="text-primary" />
          <span className="text-sm font-semibold">Mobius</span>
        </div>
        {/*<div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{STATUS_LABEL[status]}</span>
        </div>*/}
      </div>

      {/* current tab */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{host ?? "No active tab"}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {state ? (
              <>
                {capturing && <Circle size={7} weight="fill" className="text-destructive" />}
                <span>
                  {state.paused ? "Paused" : "Capturing"}, {state.mode === "rule" ? "auto rule" : "manual"}
                </span>
              </>
            ) : (
              "Not capturing"
            )}
          </div>
        </div>
        {elapsed && (
          <Badge variant="outline" className="font-mono tabular-nums">
            {elapsed}
          </Badge>
        )}
      </div>

      {/* event counters — hidden until the MCP server is actually running, nothing to show yet */}
      {!mcpDown && (
        <div className="px-3 py-3">
          <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-border bg-border">
            {COUNTER_ITEMS.map(({ key, label, icon: Icon, tone, settingsKey }) => {
              const paused = captureOptions ? captureOptions[settingsKey] === false : false;
              return (
                <div key={key} className="flex flex-col items-center gap-1 bg-card px-1 py-2.5">
                  <Icon size={14} className={tone} />
                  {paused ? (
                    <span className="text-sm font-semibold text-destructive">Paused</span>
                  ) : (
                    <span className="font-mono text-sm font-semibold tabular-nums">{counters[key]}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* mcp status */}
      <div className="px-3 py-2.5">
        <Card size="sm">
          <CardContent className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-medium text-muted-foreground">MCP server</div>
              <div className="truncate font-mono text-sm">{WS_URL}</div>
            </div>
            <div className="shrink-0 text-right text-xs">
              {status === "connected" ? (
                <span className="text-success">{push?.connection.lastEventAt ? formatAgo(push.connection.lastEventAt) : "connected"}</span>
              ) : status === "connecting" ? (
                <span className="text-warning">connecting…</span>
              ) : (
                <span className="text-muted-foreground">not running</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* live feed — hidden until the MCP server is actually running, nothing to show yet */}
      {!mcpDown && (
        <>
          {feed.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">No events yet</div>
          ) : (
            <ScrollArea className="h-32">
              <ul className="flex flex-col gap-1.5 px-3 py-2">
                {feed.map((item, i) => (
                  <li key={`${item.timestamp}-${i}`} className="flex items-start gap-2 text-xs overflow-x-hidden">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-none ${KIND_DOT[item.kind]}`} />
                    <span className="shrink-0 font-mono text-muted-foreground">{formatClock(item.timestamp)}</span>
                    <span className={`shrink-0 font-mono font-medium ${KIND_TEXT[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
                    <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{item.summary}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
          <Button
            variant="muted"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("logs.html") })}
            className="mt-1.5 h-auto justify-start p-0 underline-offset-2 hover:underline ml-auto mr-2 text-sm"
          >
            View all logs
          </Button>
        </>
      )}

      {/* controls + quick actions */}
      <div className="flex flex-col gap-2 px-3 py-3">
        {!state ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block w-full">
                <Button className="w-full" onClick={start} disabled={mcpDown || Boolean(restrictedReason)}>
                  <Play size={14} weight="fill" />
                  Enable tab
                </Button>
              </span>
            </TooltipTrigger>
            {restrictedReason ? (
              <TooltipContent>{restrictedReason}</TooltipContent>
            ) : (
              mcpDown && (
                <TooltipContent className="max-w-56 whitespace-normal">
                  <span>
                    MCP server isn't running. Ask your AI agent to register it — see{" "}
                    <a href={`${REPO_URL}#quick-start`} target="_blank" rel="noreferrer" className="underline">
                      the quick start
                    </a>
                  </span>
                </TooltipContent>
              )
            )}
          </Tooltip>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={pause}>
              {state.paused ? (
                <>
                  <Play size={14} weight="fill" />
                  Resume
                </>
              ) : (
                <>
                  <Pause size={14} weight="fill" />
                  Pause
                </>
              )}
            </Button>
            <Button variant="outline" onClick={stop}>
              <Stop size={14} weight="fill" />
              Stop
            </Button>
          </div>
        )}
        <Separator />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => chrome.tabs.create({ url: REPORT_BUG_URL })}>
            <Bug />
            Report bug
          </Button>
          <Button variant="outline" onClick={() => chrome.runtime.openOptionsPage()}>
            <GearSix />
            Options
          </Button>
          <Button variant="outline" onClick={clear}>
            <Trash />
            Clear
          </Button>
          <Button variant="outline" onClick={() => chrome.tabs.create({ url: REPO_URL })}>
            <ArrowSquareOut />
            Repo
          </Button>
        </div>

        {state && !state.paused ? <p className="text-center text-sm pt-2 text-muted-foreground">Your agent can now fetch this tab's runtime context via MCP.</p> : null}

        {!Boolean(restrictedReason) && host && !autoEnabled && !ruleJustAdded && (
          <Button variant="outline" onClick={addCurrentHostRule} className="h-auto justify-start border-dashed py-2 w-full">
            <span className="whitespace-normal text-left">
              Want to always capture <span className="font-mono">{host}</span>? Click here to auto-enable this host.
            </span>
          </Button>
        )}

        {ruleDenied && <p className="text-center text-xs text-destructive">Permission denied — {host} won't auto-capture. Try again if that was a mistake.</p>}

        {ruleJustAdded && (
          <p className="text-center text-xs text-muted-foreground">
            {host} will auto-capture from now on. Manage rules under Options.
          </p>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}
