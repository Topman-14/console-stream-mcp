import * as os from "node:os";
import * as path from "node:path";
import type { EventType } from "@mobius-mcp/capture-core";

export const WS_PORT_DEFAULT = 7331;

// utils/har.ts's HAR 1.2 "creator" field.
export const HAR_CREATOR_NAME = "mobius-mcp";
export const HAR_CREATOR_VERSION = "0.0.1";

export const CLIENT_PURGE_DELAY_MS = Number(process.env.CONSOLE_STREAM_PURGE_DELAY_MS) || 5 * 60 * 1000;

// Crash/restart durability (see services/persistence.ts) — a temp-dir JSONL file per tab, replayed on boot and reaped on an interval. TTL configurable by whoever launches
export const PERSISTENCE_DIR = process.env.CONSOLE_STREAM_PERSISTENCE_DIR || path.join(os.tmpdir(), "mobius-mcp", "events");
export const PERSISTENCE_TTL_MS = Number(process.env.CONSOLE_STREAM_PERSISTENCE_TTL_MS) || 60 * 60 * 1000;
export const PERSISTENCE_PRUNE_INTERVAL_MS = Math.min(Math.max(PERSISTENCE_TTL_MS / 4, 60_000), 10 * 60_000);
export const MAX_EVENTS_PER_TAB = Number(process.env.CONSOLE_STREAM_MAX_EVENTS_PER_TAB) || 3000;
export const MAX_EVENT_FIELD_LENGTH = 10_000;

export const TRUNCATABLE_EVENT_FIELDS: ReadonlyArray<readonly [field: string, flagField: string]> = [
  ["message", "messageTruncated"],
  ["stack", "stackTruncated"],
  ["reason", "reasonTruncated"],
  ["requestBody", "requestBodyTruncated"],
  ["responseBody", "responseBodyTruncated"],
];

export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
export const CONTROL_REQUEST_TIMEOUT_MS = 15_000;

export const CONSOLE_TYPES: EventType[] = ["console.log", "console.info", "console.warn"];
export const ERROR_TYPES: EventType[] = ["console.error", "window.onerror", "unhandledrejection"];
export const NETWORK_TYPES: EventType[] = ["network.fetch", "network.xhr"];
export const NAVIGATION_TYPES: EventType[] = ["navigation"];
export const DOM_TYPES: EventType[] = ["dom.mutation"];

export const EVENT_CATEGORIES: Record<string, EventType[]> = {
  console: [...CONSOLE_TYPES, ...ERROR_TYPES],
  network: NETWORK_TYPES,
  navigation: NAVIGATION_TYPES,
  dom: DOM_TYPES,
};
