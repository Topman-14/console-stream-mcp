import { useEffect, useState } from "react";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export interface EventCounters {
  console: number;
  errors: number;
  network: number;
  runtime: number;
}

export interface FeedItem {
  timestamp: number;
  kind: keyof EventCounters;
  summary: string;
}

export interface PushState {
  connection: { status: ConnectionStatus; lastEventAt?: number };
  live: { counters: EventCounters; feed: FeedItem[]; recordingStartedAt?: number };
}

export function usePopupPort(tabId: number | undefined): PushState | null {
  const [state, setState] = useState<PushState | null>(null);

  useEffect(() => {
    if (tabId === undefined) return;
    const port = chrome.runtime.connect({ name: "mobius-mcp/popup" });
    port.onMessage.addListener((message: PushState) => setState(message));
    port.postMessage({ type: "subscribe", tabId });
    return () => port.disconnect();
  }, [tabId]);

  return state;
}
