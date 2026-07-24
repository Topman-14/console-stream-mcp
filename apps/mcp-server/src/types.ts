import type { WebSocket } from "ws";
import type { BrowserEvent, ClientInfo, EventType } from "@mobius-mcp/capture-core";

// registry.ts
export type RegisteredClient = ClientInfo & { ws: WebSocket; disconnectedAt?: number };

// services/persistence.ts — implemented by EventPersistence, consumed by EventStore so
// store.ts stays ignorant of *how* events survive a restart, only that they can.
export interface EventSink {
  append(event: BrowserEvent): void;
  remove(clientId: string): void;
  clear(clientId: string): void;
}

// services/diagnostics.ts
export type DiagnoseState =
  | "ready"
  | "no_client_ever_connected"
  | "client_disconnected"
  | "handshake_rejected"
  | "ws_bind_failed"
  // Only reachable via DiagnosticsService.checkExternal (the `--health` CLI probe), which
  // runs in a process that never bound the port itself.
  | "no_server_running"
  | "error";

export interface RemediationStep {
  step: string;
  userAction: boolean;
}

export interface DiagnosePayload {
  state: DiagnoseState;
  wsPort: number;
  wsListening: boolean;
  serverVersion: string;
  protocolVersion: number;
  clients: ClientInfo[];
  everConnected: boolean;
  lastClientSeenAt: number | null;
  lastDisconnectReason: string | null;
  rejectedHandshakes: number;
  remediation: RemediationStep[];
  agentGuidance: string;
  /** Set only for state "error". */
  error?: string;
}

// commandDispatcher.ts
export interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

// jobs.ts
export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface Job {
  id: string;
  kind: string;
  status: JobStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
}

// debugSession.ts
export interface DebugSession {
  id: string;
  clientId: string;
  startSeq: number;
  types: EventType[];
  domCapture: boolean;
}

// mcpServer.ts
export interface ToolDef {
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<any>;
}

// The MCP SDK's tool-result content shape — every tool handler returns this. The index
// signature mirrors the SDK's own result type (CallToolResult carries other optional
// fields like _meta) — without it, TS's index-signature assignability rule rejects this
// named type at every server.tool() call site even though the fields it does have match.
export interface ToolTextContent {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

// Return shape shared by resolveTabId/resolveCdpTab (utils/tools.ts): the resolved
// tab's clientId, or a ready-to-return tool error when resolution failed.
export type TabResolution = { clientId: string } | { error: ToolTextContent };
