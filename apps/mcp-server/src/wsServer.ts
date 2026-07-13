import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION, isProtocolVersionSupported, type ClientMessage } from "@console-stream-mcp/protocol";
import type { EventStore } from "./store.js";
import type { ClientRegistry } from "./registry.js";
import type { CommandDispatcher } from "./commandDispatcher.js";

export function startWsServer(port: number, store: EventStore, registry: ClientRegistry, dispatcher: CommandDispatcher): WebSocketServer {
  const wss = new WebSocketServer({ host: "localhost", port });

  wss.on("connection", (ws: WebSocket) => {
    const clientIds = new Set<string>();

    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!isProtocolVersionSupported(message.version)) {
        ws.close(4000, `unsupported protocol version, server expects ${PROTOCOL_VERSION}`);
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
        registry.markDisconnected(message.clientId);
        return;
      }

      if (message.kind === "ack") {
        dispatcher.handleAck(message.commandId, message.result, message.error);
      }
    });

    ws.on("close", () => {
      for (const clientId of clientIds) {
        registry.markDisconnected(clientId);
      }
    });
  });

  return wss;
}
