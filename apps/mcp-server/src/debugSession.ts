import { randomUUID } from "node:crypto";
import type { EventType } from "@console-stream-mcp/protocol";
import type { EventStore } from "./store.js";
import type { CommandDispatcher } from "./commandDispatcher.js";
import { categoriesToTypes } from "./eventCategories.js";

interface Session {
  id: string;
  clientId: string;
  startSeq: number;
  types: EventType[];
  domCapture: boolean;
}

export class DebugSessionManager {
  private sessions = new Map<string, Session>();

  constructor(private store: EventStore, private dispatcher: CommandDispatcher) {}

  async start(clientId: string, categories: string[]): Promise<Session> {
    const types = categoriesToTypes(categories);
    const domCapture = categories.includes("dom");

    if (domCapture) {
      await this.dispatcher.sendCommand(clientId, "start_dom_capture", {});
    }

    const session: Session = { id: randomUUID(), clientId, startSeq: this.store.currentSeq(), types, domCapture };
    this.sessions.set(session.id, session);
    return session;
  }

  async end(sessionId: string): Promise<{ events: unknown[]; sessionId: string } | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    if (session.domCapture) {
      await this.dispatcher.sendCommand(session.clientId, "stop_dom_capture", {}).catch(() => {
        // tab may have navigated away already, nothing left to stop
      });
    }

    const { events } = this.store.getSince(session.clientId, session.startSeq, { types: session.types });
    this.sessions.delete(sessionId);
    return { sessionId, events };
  }
}
