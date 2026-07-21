import { EventEmitter } from "node:events";
import type { BrowserEvent, EventType } from "@mobius-mcp/capture-core";

const MAX_EVENTS_PER_TAB = Number(process.env.CONSOLE_STREAM_MAX_EVENTS_PER_TAB) || 1000;
const MAX_FIELD_LENGTH = 10_000;

const TRUNCATABLE_FIELDS = ["message", "stack", "reason", "requestBody", "responseBody"] as const;

function truncateFields(event: BrowserEvent): BrowserEvent {
  const result: Record<string, unknown> = { ...event };
  for (const field of TRUNCATABLE_FIELDS) {
    const value = result[field];
    if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) {
      result[field] = value.slice(0, MAX_FIELD_LENGTH) + "…[truncated]";
    }
  }
  return result as unknown as BrowserEvent;
}

class TabBuffer {
  private events: BrowserEvent[] = [];

  push(event: BrowserEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS_PER_TAB) {
      this.events.splice(0, this.events.length - MAX_EVENTS_PER_TAB);
    }
  }

  getRecent(types: EventType[], limit: number): BrowserEvent[] {
    return this.events.filter((e) => types.includes(e.type)).slice(-limit);
  }

  getSince(cursor: number, opts: { types?: EventType[]; limit?: number } = {}): BrowserEvent[] {
    let filtered = this.events.filter((e) => e.seq > cursor);
    if (opts.types) filtered = filtered.filter((e) => opts.types!.includes(e.type));
    if (opts.limit) filtered = filtered.slice(0, opts.limit);
    return filtered;
  }

  clear(): void {
    this.events = [];
  }
}

/**
 * seq is a single counter shared across all tabs' buffers (not per-tab), so events
 * from different tabs remain orderable relative to each other by seq alone.
 */
export class EventStore {
  private buffers = new Map<string, TabBuffer>();
  private nextSeq = 1;
  private emitter = new EventEmitter();

  private bufferFor(clientId: string): TabBuffer {
    let buffer = this.buffers.get(clientId);
    if (!buffer) {
      buffer = new TabBuffer();
      this.buffers.set(clientId, buffer);
    }
    return buffer;
  }

  addEvent(event: Omit<BrowserEvent, "seq">): BrowserEvent {
    const stored = truncateFields({ ...event, seq: this.nextSeq++ } as BrowserEvent);
    this.bufferFor(event.clientId).push(stored);
    this.emitter.emit("event", stored);
    return stored;
  }

  /** Fires for every event across all tabs; listeners filter by clientId/type themselves. */
  onEvent(listener: (event: BrowserEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  getRecent(clientId: string, types: EventType[], limit: number): BrowserEvent[] {
    return this.buffers.get(clientId)?.getRecent(types, limit) ?? [];
  }

  getSince(clientId: string, cursor: number, opts: { types?: EventType[]; limit?: number } = {}): { events: BrowserEvent[]; cursor: number } {
    const events = this.buffers.get(clientId)?.getSince(cursor, opts) ?? [];
    const newCursor = events.length > 0 ? events[events.length - 1].seq : cursor;
    return { events, cursor: newCursor };
  }

  currentSeq(): number {
    return this.nextSeq - 1;
  }

  clear(clientId: string): void {
    this.buffers.get(clientId)?.clear();
  }

  deleteBuffer(clientId: string): void {
    this.buffers.delete(clientId);
  }
}
