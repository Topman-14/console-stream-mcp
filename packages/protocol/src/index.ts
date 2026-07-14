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

/**
 * Only one mobius-mcp process per machine can bind the WS port — the "hub". Every other
 * process that loses that race (e.g. a second Claude Code session's own spawned instance)
 * becomes a "follower": instead of running its own WS server, it forwards MCP tool calls
 * to the hub over this control channel so any session can reach the one real browser
 * connection regardless of which process actually holds the port.
 */
export type ControlMessage =
  | { version: typeof PROTOCOL_VERSION; kind: "control-request"; requestId: string; tool: string; args: unknown }
  | { version: typeof PROTOCOL_VERSION; kind: "control-response"; requestId: string; result?: unknown; error?: string };

export function isProtocolVersionSupported(version: number): boolean {
  return version === PROTOCOL_VERSION;
}
