import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION, isProtocolVersionSupported, type ClientMessage, type ControlMessage } from "@mobius-mcp/capture-core";
import type { EventStore } from "../services/store.js";
import type { ClientRegistry } from "../services/registry.js";
import type { CommandDispatcher } from "../services/commandDispatcher.js";
import type { DiagnosticsService } from "../services/diagnostics.js";
import type { ToolDef } from "../types.js";

/** Resolves once the port is actually bound (this process becomes the hub), rejects on
 * bind failure (most commonly EADDRINUSE — another mobius-mcp process already holds the
 * port, so the caller should fall back to follower mode instead of crashing). */
export function startWsServer(
  port: number,
  store: EventStore,
  registry: ClientRegistry,
  dispatcher: CommandDispatcher,
  toolDefs: Map<string, ToolDef>,
  diagnostics: DiagnosticsService,
): Promise<WebSocketServer> {
  const wss = new WebSocketServer({ host: "localhost", port });

  return new Promise((resolve, reject) => {
    let settled = false;

    wss.on("listening", () => {
      console.error(`[mobius-mcp] WebSocket server listening on ws://localhost:${port}`);
      diagnostics.reportListening(port);
      if (!settled) {
        settled = true;
        resolve(wss);
      }
    });

    wss.on("error", (err) => {
      console.error(`[mobius-mcp] WebSocket server error:`, err);
      diagnostics.reportBindFailed(port, err);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    wss.on("connection", (ws: WebSocket) => {
      const clientIds = new Set<string>();
      console.error("[mobius-mcp] client connected");

      ws.on("message", (raw) => {
        let message: ClientMessage | ControlMessage;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }

        if (!isProtocolVersionSupported(message.version)) {
          diagnostics.reportHandshakeRejected();
          ws.close(4000, `unsupported protocol version, server expects ${PROTOCOL_VERSION}`);
          return;
        }

        if (message.kind === "control-request") {
          const def = toolDefs.get(message.tool);
          if (!def) {
            ws.send(JSON.stringify({ version: PROTOCOL_VERSION, kind: "control-response", requestId: message.requestId, error: `Unknown tool: ${message.tool}` }));
            return;
          }
          Promise.resolve(def.handler(message.args))
            .then((result) => {
              ws.send(JSON.stringify({ version: PROTOCOL_VERSION, kind: "control-response", requestId: message.requestId, result }));
            })
            .catch((err) => {
              ws.send(JSON.stringify({ version: PROTOCOL_VERSION, kind: "control-response", requestId: message.requestId, error: err instanceof Error ? err.message : String(err) }));
            });
          return;
        }

        if (message.kind === "hello") {
          const clientId = message.client.clientId || randomUUID();
          clientIds.add(clientId);
          registry.register({ ...message.client, clientId, connectedAt: Date.now() }, ws);
          return;
        }

        if (message.kind === "event" && clientIds.has(message.clientId)) {
          store.addEvent({ ...message.event, id: randomUUID(), clientId: message.clientId });
          return;
        }

        if (message.kind === "bye" && clientIds.has(message.clientId)) {
          clientIds.delete(message.clientId);
          registry.markDisconnected(message.clientId, "bye");
          return;
        }

        if (message.kind === "ack") {
          dispatcher.handleAck(message.commandId, message.result, message.error);
        }
      });

      ws.on("close", () => {
        console.error("[mobius-mcp] client disconnected");
        for (const clientId of clientIds) {
          registry.markDisconnected(clientId);
        }
      });
    });
  });
}
