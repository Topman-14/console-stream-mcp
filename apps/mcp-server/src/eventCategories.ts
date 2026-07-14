import type { EventType } from "@mobius-mcp/protocol";

export const CONSOLE_TYPES: EventType[] = ["console.log", "console.info", "console.warn"];
export const ERROR_TYPES: EventType[] = ["console.error", "window.onerror", "unhandledrejection"];
export const NETWORK_TYPES: EventType[] = ["network.fetch", "network.xhr"];
export const NAVIGATION_TYPES: EventType[] = ["navigation"];
export const DOM_TYPES: EventType[] = ["dom.mutation"];

const CATEGORIES: Record<string, EventType[]> = {
  console: [...CONSOLE_TYPES, ...ERROR_TYPES],
  network: NETWORK_TYPES,
  navigation: NAVIGATION_TYPES,
  dom: DOM_TYPES,
};

export function categoriesToTypes(categories: string[]): EventType[] {
  return categories.flatMap((c) => CATEGORIES[c] ?? []);
}
