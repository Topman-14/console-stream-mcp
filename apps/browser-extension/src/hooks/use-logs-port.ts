import { useEffect, useState } from "react";
import type { ConnectionStatus, EventCounters, FeedItem } from "./use-popup-port.js";

export interface TabLiveState {
  counters: EventCounters;
  feed: FeedItem[];
  recordingStartedAt?: number;
}

export interface LogsPushState {
  connection: { status: ConnectionStatus; lastEventAt?: number };
  tabs: Record<number, TabLiveState>;
}

// The MV3 background service worker unloads after ~30s idle, wiping its in-memory
// port registry (live-state.ts). A port connected before that becomes a zombie that
// never receives another push. Reconnect on disconnect for the common case, and poll
// as a backstop in case a disconnect event never fires for some reason.
const POLL_INTERVAL_MS = 3000;

export function useLogsPort(): LogsPushState | null {
  const [state, setState] = useState<LogsPushState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let port: chrome.runtime.Port | undefined;

    const connect = () => {
      if (cancelled) return;
      port = chrome.runtime.connect({ name: "mobius-mcp/logs" });
      port.onMessage.addListener((message: LogsPushState) => setState(message));
      port.onDisconnect.addListener(() => {
        if (cancelled) return;
        connect();
      });
    };
    connect();

    const poll = setInterval(() => {
      chrome.runtime.sendMessage({ type: "mobius-mcp/get-all-live-state" }, (response: LogsPushState | undefined) => {
        if (chrome.runtime.lastError || !response) return;
        setState(response);
      });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      port?.disconnect();
    };
  }, []);

  return state;
}
