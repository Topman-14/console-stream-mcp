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

export function useLogsPort(): LogsPushState | null {
  const [state, setState] = useState<LogsPushState | null>(null);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "mobius-mcp/logs" });
    port.onMessage.addListener((message: LogsPushState) => setState(message));
    return () => port.disconnect();
  }, []);

  return state;
}
