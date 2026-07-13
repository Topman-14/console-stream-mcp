import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION, type ServerMessage } from "@console-stream-mcp/protocol";
import type { ClientRegistry } from "./registry.js";

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class CommandDispatcher {
  private pending = new Map<string, Pending>();

  constructor(private registry: ClientRegistry) {}

  sendCommand(clientId: string, command: string, params: unknown = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const ws = this.registry.getWs(clientId);
    if (!ws) {
      return Promise.reject(new Error(`No connected client with id ${clientId}`));
    }

    const commandId = randomUUID();
    const message: ServerMessage = { version: PROTOCOL_VERSION, kind: "command", commandId, clientId, command, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(new Error(`Command "${command}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(commandId, { resolve, reject, timer });
      ws.send(JSON.stringify(message));
    });
  }

  handleAck(commandId: string, result: unknown, error?: string): void {
    const pending = this.pending.get(commandId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(commandId);
    if (error) pending.reject(new Error(error));
    else pending.resolve(result);
  }
}
