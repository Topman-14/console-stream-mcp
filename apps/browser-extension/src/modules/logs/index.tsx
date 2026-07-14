import { useEffect, useState } from "react";
import { Infinity as InfinityIcon } from "@phosphor-icons/react";
import { useTheme } from "../../hooks/use-theme.js";
import { useLogsPort } from "../../hooks/use-logs-port.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { Badge } from "../../components/ui/badge.js";
import { Separator } from "../../components/ui/separator.js";
import { KIND_DOT, KIND_TEXT, KIND_LABEL } from "../popup/data.js";

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface TabMeta {
  title?: string;
  host?: string;
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function Logs() {
  useTheme();
  const push = useLogsPort();
  const [tabMeta, setTabMeta] = useState<Record<number, TabMeta>>({});

  const tabIds = push ? Object.keys(push.tabs).map(Number) : [];

  useEffect(() => {
    const missing = tabIds.filter((id) => !(id in tabMeta));
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (tabId) => {
        try {
          const tab = await chrome.tabs.get(tabId);
          return [tabId, { title: tab.title, host: hostOf(tab.url) }] as const;
        } catch {
          return [tabId, { title: "Closed tab" }] as const;
        }
      }),
    ).then((entries) => setTabMeta((prev) => ({ ...prev, ...Object.fromEntries(entries) })));
  }, [tabIds.join(",")]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <InfinityIcon size={24} weight="bold" className="text-primary" />
        Mobius
      </h1>
      <p className="mt-1 text-muted-foreground">Live logs from every tab currently capturing.</p>

      <div className="mt-6 flex flex-col gap-6">
        {tabIds.length === 0 && <p className="text-sm text-muted-foreground">No tabs are capturing right now.</p>}

        {tabIds.map((tabId) => {
          const live = push!.tabs[tabId];
          const meta = tabMeta[tabId];
          return (
            <section key={tabId}>
              <div className="flex items-center justify-between">
                <h2 className="truncate font-semibold text-xl">{meta?.host ?? meta?.title ?? `Tab ${tabId}`}</h2>
                <Badge variant="outline" className="font-mono tabular-nums">
                  {Object.values(live.counters).reduce((sum, n) => sum + n, 0)} events
                </Badge>
              </div>
              <Separator className="mt-2" />
              <Card size="sm" className="mt-3 h-48 min-h-32 resize-y overflow-auto">
                <CardContent>
                  {live.feed.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">No events yet</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {live.feed.map((item, i) => (
                        <li key={`${item.timestamp}-${i}`} className="flex items-start gap-2 text-sm">
                          <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-none ${KIND_DOT[item.kind]}`} />
                          <span className="shrink-0 font-mono text-muted-foreground">{formatClock(item.timestamp)}</span>
                          <span className={`shrink-0 font-mono font-medium ${KIND_TEXT[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
                          <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{item.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
          );
        })}
      </div>
    </div>
  );
}
