import type { ClientInfo } from "@mobius-mcp/capture-core";
import type { WebSocket } from "ws";
import { CLIENT_PURGE_DELAY_MS } from "../data.js";
import type { RegisteredClient } from "../types.js";

export class ClientRegistry {
  private clients = new Map<string, RegisteredClient>();
  private purgeTimers = new Map<string, NodeJS.Timeout>();
  private onPurge?: (clientId: string) => void;

  // Process-lifetime history that survives purge — see mobius_diagnose (services/diagnostics.ts),
  // which is the reason this exists: `list()` alone only reflects who's connected *right now*.
  private everConnectedFlag = false;
  private lastSeenAt: number | undefined;
  private lastDisconnectReason: string | undefined;

  setOnPurge(callback: (clientId: string) => void): void {
    this.onPurge = callback;
  }

  register(client: ClientInfo, ws: WebSocket): void {
    clearTimeout(this.purgeTimers.get(client.clientId));
    this.purgeTimers.delete(client.clientId);
    this.clients.set(client.clientId, { ...client, ws, disconnectedAt: undefined });
    this.everConnectedFlag = true;
    this.lastSeenAt = Date.now();
  }

  markDisconnected(clientId: string, reason: string = "connection_lost"): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.disconnectedAt = Date.now();
    this.lastSeenAt = Date.now();
    this.lastDisconnectReason = reason;

    const timer = setTimeout(() => {
      this.clients.delete(clientId);
      this.purgeTimers.delete(clientId);
      this.onPurge?.(clientId);
    }, CLIENT_PURGE_DELAY_MS);
    this.purgeTimers.set(clientId, timer);
  }

  getHistory(): { everConnected: boolean; lastClientSeenAt: number | null; lastDisconnectReason: string | null } {
    return {
      everConnected: this.everConnectedFlag,
      lastClientSeenAt: this.lastSeenAt ?? null,
      lastDisconnectReason: this.lastDisconnectReason ?? null,
    };
  }

  get(clientId: string): ClientInfo | undefined {
    const client = this.clients.get(clientId);
    if (!client) return undefined;
    const { ws: _ws, ...info } = client;
    return info;
  }

  getWs(clientId: string): WebSocket | undefined {
    return this.clients.get(clientId)?.ws;
  }

  list(): ClientInfo[] {
    return Array.from(this.clients.values())
      .filter((c) => c.disconnectedAt === undefined)
      .map(({ ws: _ws, disconnectedAt: _d, ...info }) => info);
  }
}
