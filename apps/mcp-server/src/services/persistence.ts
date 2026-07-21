import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { BrowserEvent } from "@mobius-mcp/capture-core";
import type { EventSink } from "../types.js";
import { MAX_EVENTS_PER_TAB, PERSISTENCE_DIR, PERSISTENCE_PRUNE_INTERVAL_MS, PERSISTENCE_TTL_MS } from "../data.js";

const FILE_SUFFIX = ".jsonl";

/**
 * Crash/restart durability for EventStore: one append-only JSONL file per tab in a
 * temp directory, replayed into memory on boot (loadAll) and reaped on an interval
 * (prune) so nothing survives past ttlMs. Deliberately not SQLite/better-sqlite3 — the
 * working set here is a handful of MB at most (same cap as the in-memory ring buffer),
 * so there's no query-performance case for an embedded DB, and a native dependency
 * would add real install risk (prebuilt-binary/platform issues) for a CLI tool with
 * an "engines": ">=18" floor that also rules out node:sqlite (stable only on 22.5+).
 */
export class EventPersistence implements EventSink {
  private queues = new Map<string, Promise<void>>();
  private pruneTimer: NodeJS.Timeout;

  constructor(private dir: string = PERSISTENCE_DIR, private ttlMs: number = PERSISTENCE_TTL_MS) {
    this.pruneTimer = setInterval(() => void this.prune(), PERSISTENCE_PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  private fileFor(clientId: string): string {
    return path.join(this.dir, `${clientId}${FILE_SUFFIX}`);
  }

  /** Serializes every read/append/rewrite for one tab's file behind a promise chain — a
   * cheap stand-in for a mutex, so the periodic prune() rewrite can never interleave
   * with a concurrent append() and corrupt the file or silently drop a line. */
  private enqueue(clientId: string, task: () => Promise<void>): void {
    const next = (this.queues.get(clientId) ?? Promise.resolve()).then(task, task).catch(() => {});
    this.queues.set(clientId, next);
  }

  /** Fire-and-forget: live capture must never block on disk I/O. */
  append(event: BrowserEvent): void {
    this.enqueue(event.clientId, async () => {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.appendFile(this.fileFor(event.clientId), JSON.stringify(event) + "\n");
    });
  }

  remove(clientId: string): void {
    this.enqueue(clientId, async () => {
      await fs.rm(this.fileFor(clientId), { force: true });
    });
  }

  clear(clientId: string): void {
    this.remove(clientId);
  }

  /** Startup recovery: replay every on-disk tab's events (dropping anything past the
   * TTL, and anything beyond MAX_EVENTS_PER_TAB, same as the live ring buffer's cap). */
  async loadAll(): Promise<Map<string, BrowserEvent[]>> {
    await fs.mkdir(this.dir, { recursive: true });
    const files = await fs.readdir(this.dir).catch(() => []);
    const result = new Map<string, BrowserEvent[]>();

    for (const file of files) {
      if (!file.endsWith(FILE_SUFFIX)) continue;
      const clientId = file.slice(0, -FILE_SUFFIX.length);
      const events = await this.readEvents(path.join(this.dir, file));
      if (events.length > 0) result.set(clientId, events.slice(-MAX_EVENTS_PER_TAB));
      else await fs.rm(path.join(this.dir, file), { force: true }).catch(() => {});
    }
    return result;
  }

  private async readEvents(filePath: string): Promise<BrowserEvent[]> {
    const cutoff = Date.now() - this.ttlMs;
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    const events: BrowserEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const event = JSON.parse(line) as BrowserEvent;
        if (event.timestamp >= cutoff) events.push(event);
      } catch {
        // one torn line from a hard kill mid-write shouldn't sink the rest of the file
      }
    }
    return events;
  }

  /** The "cleaned up over time" half of persistence: rewrites each tab's file down to
   * its non-expired, in-cap lines on an interval, deleting anything left with nothing
   * in it — catches tabs that disconnected (or the whole process crashed) without ever
   * reaching remove(). */
  private async prune(): Promise<void> {
    const files = await fs.readdir(this.dir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(FILE_SUFFIX)) continue;
      const clientId = file.slice(0, -FILE_SUFFIX.length);
      const filePath = path.join(this.dir, file);
      this.enqueue(clientId, async () => {
        const events = (await this.readEvents(filePath)).slice(-MAX_EVENTS_PER_TAB);
        if (events.length === 0) await fs.rm(filePath, { force: true }).catch(() => {});
        else await fs.writeFile(filePath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
      });
    }
  }

  close(): void {
    clearInterval(this.pruneTimer);
  }
}
