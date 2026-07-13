export * from "./events.js";
import type { BrowserEvent, ClientInfo } from "./events.js";

export const PROTOCOL_VERSION = 1;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type CapturedEvent = DistributiveOmit<BrowserEvent, "id" | "seq" | "clientId">;

export type ClientMessage =
  | { version: typeof PROTOCOL_VERSION; kind: "hello"; client: Omit<ClientInfo, "connectedAt"> }
  | { version: typeof PROTOCOL_VERSION; kind: "event"; clientId: string; event: CapturedEvent }
  | { version: typeof PROTOCOL_VERSION; kind: "bye"; clientId: string }
  | { version: typeof PROTOCOL_VERSION; kind: "ack"; commandId: string; result?: unknown; error?: string };

export type ServerMessage = {
  version: typeof PROTOCOL_VERSION;
  kind: "command";
  commandId: string;
  clientId: string;
  command: string;
  params: unknown;
};

export function isProtocolVersionSupported(version: number): boolean {
  return version === PROTOCOL_VERSION;
}
