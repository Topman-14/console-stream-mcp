import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, type ControlMessage } from "@mobius-mcp/capture-core";
import { CONTROL_REQUEST_TIMEOUT_MS } from "../data.js";

/** Used by a follower process (see index.ts) to forward MCP tool calls to whichever
 * process actually won the WS port bind and is acting as the hub. */
export class ControlClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private retryDelay = 500;

  constructor(private port: number) {
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(`ws://localhost:${this.port}`);
    this.ws = ws;

    ws.on("open", () => {
      this.retryDelay = 500;
      console.error(`[mobius-mcp] follower mode: connected to hub on ws://localhost:${this.port}`);
    });

    ws.on("message", (raw) => {
      let message: ControlMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.kind !== "control-response") return;
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });

    ws.on("close", () => {
      console.error(`[mobius-mcp] follower mode: lost connection to hub, retrying in ${this.retryDelay}ms`);
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 10_000);
    });

    ws.on("error", () => ws.close());
  }

  invoke(tool: string, args: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();

      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("mobius-mcp hub unavailable or request timed out — is another mobius-mcp process still running?"));
      }, CONTROL_REQUEST_TIMEOUT_MS);

      this.pending.set(requestId, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      const message: ControlMessage = { version: PROTOCOL_VERSION, kind: "control-request", requestId, tool, args };
      const send = () => this.ws?.send(JSON.stringify(message));
      if (this.ws && this.ws.readyState === WebSocket.OPEN) send();
      else this.ws?.once("open", send);
    });
  }
}
