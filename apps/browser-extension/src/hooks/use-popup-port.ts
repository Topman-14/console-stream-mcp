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

// See use-logs-port.ts for why both reconnect-on-disconnect and polling exist: the MV3
// background service worker can unload and wipe its in-memory port registry mid-session.
const POLL_INTERVAL_MS = 3000;

export function usePopupPort(tabId: number | undefined): PushState | null {
  const [state, setState] = useState<PushState | null>(null);

  useEffect(() => {
    if (tabId === undefined) return;
    let cancelled = false;
    let port: chrome.runtime.Port | undefined;

    const connect = () => {
      if (cancelled) return;
      port = chrome.runtime.connect({ name: "mobius-mcp/popup" });
      port.onMessage.addListener((message: PushState) => setState(message));
      port.postMessage({ type: "subscribe", tabId });
      port.onDisconnect.addListener(() => {
        if (cancelled) return;
        connect();
      });
    };
    connect();

    const poll = setInterval(() => {
      chrome.runtime.sendMessage({ type: "mobius-mcp/get-live-state", tabId }, (response: PushState | undefined) => {
        if (chrome.runtime.lastError || !response) return;
        setState(response);
      });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      port?.disconnect();
    };
  }, [tabId]);

  return state;
}
