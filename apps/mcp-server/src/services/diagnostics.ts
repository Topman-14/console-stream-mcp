import { PROTOCOL_VERSION } from "@mobius-mcp/capture-core";
import type { ClientRegistry } from "./registry.js";
import type { DiagnosePayload, DiagnoseState, RemediationStep } from "../types.js";
import { VERSION } from "../data.js";
import { probeControlRequest } from "./controlClient.js";

const HEALTH_CHECK_TIMEOUT_MS = 3000;

// "no_server_running"/"error" only ever come from DiagnosticsService.checkExternal — the
// in-process diagnose() below can't produce them, so its switch stays exhaustive without dummy cases.
type InProcessState = Exclude<DiagnoseState, "no_server_running" | "error">;

function basePayload(port: number, overrides: Pick<DiagnosePayload, "state" | "remediation" | "agentGuidance"> & Partial<DiagnosePayload>): DiagnosePayload {
  return {
    wsPort: port,
    wsListening: false,
    serverVersion: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    clients: [],
    everConnected: false,
    lastClientSeenAt: null,
    lastDisconnectReason: null,
    rejectedHandshakes: 0,
    ...overrides,
  };
}

export class DiagnosticsService {
  /** Backs `npx mobius-mcp --health`, run from a brand-new process with no registry of its
   * own — it probes whatever hub is on `port` over the control-request channel instead. */
  static async checkExternal(port: number): Promise<DiagnosePayload> {
    const probe = await probeControlRequest(port, "mobius_diagnose", {}, HEALTH_CHECK_TIMEOUT_MS);

    if (!probe.ok) {
      if (probe.reason === "unreachable") {
        return basePayload(port, {
          state: "no_server_running",
          remediation: [
            { step: `No mobius-mcp server is listening on ws://localhost:${port}.`, userAction: false },
            { step: "Start it (e.g. the MCP client config that launches `npx -y mobius-mcp`), or check CONSOLE_STREAM_PORT if a non-default port is configured.", userAction: true },
          ],
          agentGuidance: "No mobius-mcp process is running at all. Relay the remediation to the user and do not retry mobius tools until a server is confirmed running.",
        });
      }
      return basePayload(port, { state: "error", error: probe.error, remediation: [], agentGuidance: "" });
    }

    // control-response forwards the tool handler's raw ToolTextContent shape verbatim
    // (see wsServer.ts), so it needs unwrapping same as an MCP client would.
    try {
      const wrapped = probe.result as { content: Array<{ type: string; text: string }> };
      return JSON.parse(wrapped.content[0].text) as DiagnosePayload;
    } catch {
      return basePayload(port, {
        state: "error",
        error: "Received an unparseable response from the mobius-mcp hub.",
        remediation: [],
        agentGuidance: "",
      });
    }
  }

  private wsPort: number | undefined;
  private wsListening = false;
  private wsBindError: string | undefined;
  private rejectedHandshakes = 0;

  constructor(private registry: ClientRegistry) {}

  reportListening(port: number): void {
    this.wsPort = port;
    this.wsListening = true;
    this.wsBindError = undefined;
  }

  reportBindFailed(port: number, err: unknown): void {
    this.wsPort = port;
    this.wsListening = false;
    this.wsBindError = err instanceof Error ? err.message : String(err);
  }

  reportHandshakeRejected(): void {
    this.rejectedHandshakes += 1;
  }

  diagnose(): DiagnosePayload {
    const clients = this.registry.list();
    const { everConnected, lastClientSeenAt, lastDisconnectReason } = this.registry.getHistory();

    const state: InProcessState = !this.wsListening
      ? "ws_bind_failed"
      : clients.length > 0
        ? "ready"
        : this.rejectedHandshakes > 0 && !everConnected
          ? "handshake_rejected"
          : !everConnected
            ? "no_client_ever_connected"
            : "client_disconnected";

    let remediation: RemediationStep[];
    switch (state) {
      case "ws_bind_failed":
        remediation = [
          { step: `The mobius-mcp WebSocket server failed to bind port ${this.wsPort ?? "unknown"}${this.wsBindError ? ` (${this.wsBindError})` : ""}.`, userAction: false },
          { step: "Check whether another process is using this port, or set CONSOLE_STREAM_PORT to a free one and restart.", userAction: true },
        ];
        break;
      case "ready":
        remediation = [];
        break;
      case "handshake_rejected":
        remediation = [
          { step: "A client attempted to connect but its protocol version did not match this server's — most likely an outdated browser extension or server build.", userAction: false },
          { step: "Update the mobius-mcp browser extension to the latest version.", userAction: true },
          { step: "If the extension is already current, update the server: npx -y mobius-mcp@latest.", userAction: true },
        ];
        break;
      case "no_client_ever_connected":
        remediation = [
          { step: "Confirm the mobius-mcp browser extension is installed and enabled at chrome://extensions.", userAction: true },
          { step: "Click the mobius-mcp toolbar icon on the target tab and toggle capture on.", userAction: true },
          { step: "Reload the tab after enabling capture.", userAction: true },
        ];
        break;
      case "client_disconnected":
        remediation = [
          { step: `A tab was connected before but none are connected now${lastDisconnectReason ? ` (last disconnect: ${lastDisconnectReason})` : ""}.`, userAction: false },
          { step: "Reload the target tab, or click the mobius-mcp toolbar icon to re-enable capture.", userAction: true },
        ];
        break;
    }

    return {
      state,
      wsPort: this.wsPort ?? 0,
      wsListening: this.wsListening,
      serverVersion: VERSION,
      protocolVersion: PROTOCOL_VERSION,
      clients,
      everConnected,
      lastClientSeenAt,
      rejectedHandshakes: this.rejectedHandshakes,
      lastDisconnectReason,
      remediation,
      agentGuidance:
        state === "ready"
          ? "mobius-mcp is ready — proceed with other tools."
          : 'Do not call other mobius tools until state is "ready". Relay the remediation steps to the user verbatim and stop — do not retry automatically, and do not silently fall back to another browser tool.',
    };
  }
}
