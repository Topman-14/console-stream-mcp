// Event schema — the shape of each captured browser event, keyed by `type`.
export interface EventBase {
  id: string;
  seq: number;
  clientId: string;
  timestamp: number;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface ConsoleEvent extends EventBase {
  type: "console.log" | "console.info" | "console.warn" | "console.error";
  message: string;
  // Set only if the server's own store cap cut this further — the original value
  // isn't recoverable afterward (unlike a network body, there's no fallback fetch).
  messageTruncated?: boolean;
  args?: unknown[];
}

export interface RuntimeErrorEvent extends EventBase {
  type: "window.onerror";
  message: string;
  messageTruncated?: boolean;
  stack?: string;
  stackTruncated?: boolean;
  source?: string;
  lineno?: number;
  colno?: number;
}

export interface UnhandledRejectionEvent extends EventBase {
  type: "unhandledrejection";
  reason: string;
  reasonTruncated?: boolean;
  stack?: string;
  stackTruncated?: boolean;
}

export interface NetworkEvent extends EventBase {
  type: "network.fetch" | "network.xhr";
  method: string;
  requestUrl: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  error?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  mimeType?: string;
  requestBody?: string;
  requestBodyTruncated?: boolean;
  requestBodyOmittedReason?: string;
  responseBody?: string;
  responseBodyTruncated?: boolean;
  responseBodyOmittedReason?: string;
}

export interface NavigationEvent extends EventBase {
  type: "navigation";
  fromUrl?: string;
  toUrl: string;
}

export interface DomMutationEvent extends EventBase {
  type: "dom.mutation";
  mutationType: "childList" | "attributes" | "characterData";
  targetSelector?: string;
  addedCount: number;
  removedCount: number;
}

// Every event a client can emit, discriminated by `type`.
export type BrowserEvent =
  | ConsoleEvent
  | RuntimeErrorEvent
  | UnhandledRejectionEvent
  | NetworkEvent
  | NavigationEvent
  | DomMutationEvent;

export type EventType = BrowserEvent["type"];

// Which event categories a client has capture enabled for — reported on connect,
// so a tool can tell "nothing happened" apart from "that category is off".
export interface CaptureSettings {
  console: boolean;
  errors: boolean;
  network: boolean;
  navigation: boolean;
  dom: boolean;
}

// One connected browser tab/client, as tracked by the server's registry.
export interface ClientInfo {
  clientId: string;
  clientType: "extension" | "npm-client";
  pageUrl: string;
  title?: string;
  capabilities: string[];
  connectedAt: number;
  captureSettings?: CaptureSettings;
}

// Wire protocol — the message envelope exchanged over the WebSocket between a
// browser client and the server, plus the version gate on that envelope's shape.
export type ProtocolVersion = 1;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
// A BrowserEvent as the client sends it: id/seq/clientId aren't known yet — the
// server assigns those on ingest (see EventStore/registry), not the capturing client.
export type CapturedEvent = DistributiveOmit<BrowserEvent, "id" | "seq" | "clientId">;

type Versioned<T> = T & { version: ProtocolVersion };

// Client -> server: hello (connect), event (a captured BrowserEvent), bye
// (disconnect), ack (reply to a "command" the server sent).
export type ClientMessage = Versioned<
  | { kind: "hello"; client: Omit<ClientInfo, "connectedAt"> }
  | { kind: "event"; clientId: string; event: CapturedEvent }
  | { kind: "bye"; clientId: string }
  | { kind: "ack"; commandId: string; result?: unknown; error?: string }
>;

// Server -> client: an RPC-style command (navigate, screenshot, evaluate_js, ...),
// matched back to its caller by commandId when the client's ack arrives.
export type ServerMessage = Versioned<{
  kind: "command";
  commandId: string;
  clientId: string;
  command: string;
  params: unknown;
}>;

// Follower -> hub only (see CommandDispatcher/ControlClient): forwards an MCP tool
// call to whichever process actually holds the WebSocket port.
export type ControlMessage = Versioned<
  | { kind: "control-request"; requestId: string; tool: string; args: unknown }
  | { kind: "control-response"; requestId: string; result?: unknown; error?: string }
>;

// Capture configuration — what the patch functions in main.ts accept, not part
// of the wire protocol itself.
export interface RedactionOptions {
  redactedHeaderNames: string[];
  maskEmails: boolean;
  maskJwts: boolean;
  redactSensitiveBodyFields: boolean;
}

// The four console methods patchConsole hooks.
export enum ConsoleMethod {
  Log = "log",
  Info = "info",
  Warn = "warn",
  Error = "error",
}

// Callback every patch function reports a captured event through.
export type Emit = (event: CapturedEvent) => void;

export interface CaptureStartOptions {
  console?: boolean;
  errors?: boolean;
  network?: boolean;
  navigation?: boolean;
  redaction?: RedactionOptions;
}

// Result of reading a request/response body: present, truncated at the size cap,
// or skipped (with why) — never all three at once.
export interface BodyCapture {
  body?: string;
  truncated?: boolean;
  omittedReason?: string;
}
