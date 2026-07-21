import type { BrowserEvent } from "@mobius-mcp/capture-core";
import type { EventStore } from "./store.js";
import { ERROR_TYPES, NAVIGATION_TYPES, NETWORK_TYPES } from "./eventCategories.js";

function waitForEvent(store: EventStore, clientId: string, predicate: (e: BrowserEvent) => boolean, timeoutMs: number): Promise<BrowserEvent | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);

    const unsubscribe = store.onEvent((event) => {
      if (event.clientId !== clientId || !predicate(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

export function waitForConsoleError(store: EventStore, clientId: string, timeoutMs: number): Promise<BrowserEvent | null> {
  return waitForEvent(store, clientId, (e) => ERROR_TYPES.includes(e.type), timeoutMs);
}

export function waitForNavigation(store: EventStore, clientId: string, timeoutMs: number): Promise<BrowserEvent | null> {
  return waitForEvent(store, clientId, (e) => NAVIGATION_TYPES.includes(e.type), timeoutMs);
}

export function waitForRequest(store: EventStore, clientId: string, urlPattern: string, timeoutMs: number): Promise<BrowserEvent | null> {
  return waitForEvent(
    store,
    clientId,
    (e) => NETWORK_TYPES.includes(e.type) && "requestUrl" in e && e.requestUrl.includes(urlPattern),
    timeoutMs,
  );
}
