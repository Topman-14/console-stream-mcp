import type { BrowserEvent, EventType } from "@mobius-mcp/capture-core";
import { EVENT_CATEGORIES, MAX_EVENT_FIELD_LENGTH, TRUNCATABLE_EVENT_FIELDS } from "../data.js";

export function categoriesToTypes(categories: string[]): EventType[] {
  return categories.flatMap((c) => EVENT_CATEGORIES[c] ?? []);
}

export function truncateEventFields(event: BrowserEvent): BrowserEvent {
  const result: Record<string, unknown> = { ...event };
  for (const [field, flagField] of TRUNCATABLE_EVENT_FIELDS) {
    const value = result[field];
    if (typeof value === "string" && value.length > MAX_EVENT_FIELD_LENGTH) {
      result[field] = value.slice(0, MAX_EVENT_FIELD_LENGTH) + "…[truncated]";
      result[flagField] = true;
    }
  }
  return result as unknown as BrowserEvent;
}
