import type { CapturedEvent } from "@mobius-mcp/capture-core";

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

export interface TabLiveState {
  counters: EventCounters;
  feed: FeedItem[];
  recordingStartedAt?: number;
}

// chrome.storage.session has a ~10MB total quota, shared across every capturing tab. At this
// cap (3000 items * ~1000 chars) a single busy tab tops out around ~3MB, leaving room for
// several tabs to capture at once without approaching the quota.
const FEED_LIMIT = 3000;
const MAX_SUMMARY_LENGTH = 1000;

function truncate(text: string): string {
  return text.length > MAX_SUMMARY_LENGTH ? `${text.slice(0, MAX_SUMMARY_LENGTH)}…` : text;
}

function emptyCounters(): EventCounters {
  return { console: 0, errors: 0, network: 0, runtime: 0 };
}

function bucketFor(type: CapturedEvent["type"]): keyof EventCounters {
  if (type === "console.error" || type === "window.onerror" || type === "unhandledrejection") return "errors";
  if (type === "console.log" || type === "console.info" || type === "console.warn") return "console";
  if (type === "network.fetch" || type === "network.xhr") return "network";
  return "runtime";
}

function summarize(event: CapturedEvent): string {
  switch (event.type) {
    case "console.log":
    case "console.info":
    case "console.warn":
    case "console.error":
      return event.message;
    case "window.onerror":
      return event.message;
    case "unhandledrejection":
      return event.reason;
    case "network.fetch":
    case "network.xhr":
      if (event.error) return `${event.method} ${event.requestUrl} — ${event.error}`;
      if (event.status) return `${event.method} ${event.requestUrl} (${event.status})`;
      return `${event.method} ${event.requestUrl} (blocked or no response)`;
    case "navigation":
      return `navigated to ${event.toUrl}`;
    case "dom.mutation":
      return `${event.mutationType} on ${event.targetSelector ?? "document"}`;
  }
}

// MV3 service workers are unloaded after ~30s of inactivity, which wipes any plain in-memory
// state. Back live state by chrome.storage.session (same fix already applied in tab-state.ts)
// so counters/feed survive a service worker restart instead of silently resetting to empty.
function liveKey(tabId: number): string {
  return `live:${tabId}`;
}

export let connectionStatus: ConnectionStatus = "disconnected";
export let lastEventAt: number | undefined;

export function setConnectionStatus(status: ConnectionStatus) {
  connectionStatus = status;
  notify();
}

export async function getTabLiveState(tabId: number): Promise<TabLiveState> {
  const result = await chrome.storage.session.get(liveKey(tabId));
  return result[liveKey(tabId)] ?? { counters: emptyCounters(), feed: [] };
}

async function setTabLiveState(tabId: number, state: TabLiveState): Promise<void> {
  await chrome.storage.session.set({ [liveKey(tabId)]: state });
}

export async function startRecording(tabId: number) {
  await setTabLiveState(tabId, { counters: emptyCounters(), feed: [], recordingStartedAt: Date.now() });
  await notify(tabId);
}

export async function stopRecording(tabId: number) {
  await chrome.storage.session.remove(liveKey(tabId));
  await notify(tabId);
}

export async function recordEvent(tabId: number, event: CapturedEvent): Promise<keyof EventCounters> {
  const state = await getTabLiveState(tabId);
  const kind = bucketFor(event.type);
  state.counters[kind]++;
  state.feed.unshift({ timestamp: event.timestamp, kind, summary: truncate(summarize(event)) });
  if (state.feed.length > FEED_LIMIT) state.feed.length = FEED_LIMIT;
  await setTabLiveState(tabId, state);
  lastEventAt = Date.now();
  await notify(tabId);
  return kind;
}

export async function getAllLiveState(): Promise<Record<number, TabLiveState>> {
  const all = await chrome.storage.session.get(null);
  const result: Record<number, TabLiveState> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("live:")) continue;
    result[Number(key.slice(5))] = value as TabLiveState;
  }
  return result;
}

export async function clearTabLiveState(tabId: number) {
  await setTabLiveState(tabId, { counters: emptyCounters(), feed: [] });
  await notify(tabId);
}

export async function clearAllTabLiveState() {
  const all = await getAllLiveState();
  await Promise.all(Object.keys(all).map((tabId) => clearTabLiveState(Number(tabId))));
}

const ports = new Map<chrome.runtime.Port, number>();
const allPorts = new Set<chrome.runtime.Port>();

export function registerPort(port: chrome.runtime.Port, tabId: number) {
  ports.set(port, tabId);
  port.onDisconnect.addListener(() => ports.delete(port));
  pushToPort(port, tabId);
}

export function registerAllPort(port: chrome.runtime.Port) {
  allPorts.add(port);
  port.onDisconnect.addListener(() => allPorts.delete(port));
  pushAllToPort(port);
}

async function pushToPort(port: chrome.runtime.Port, tabId: number) {
  port.postMessage({
    connection: { status: connectionStatus, lastEventAt },
    live: await getTabLiveState(tabId),
  });
}

async function pushAllToPort(port: chrome.runtime.Port) {
  port.postMessage({
    connection: { status: connectionStatus, lastEventAt },
    tabs: await getAllLiveState(),
  });
}

async function notify(tabId?: number) {
  for (const [port, portTabId] of ports) {
    if (tabId !== undefined && portTabId !== tabId) continue;
    try {
      await pushToPort(port, portTabId);
    } catch {
      ports.delete(port);
    }
  }
  for (const port of allPorts) {
    try {
      await pushAllToPort(port);
    } catch {
      allPorts.delete(port);
    }
  }
}
