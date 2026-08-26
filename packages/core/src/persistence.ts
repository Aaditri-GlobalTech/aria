import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CoreEvent } from "./types";

const journaledEventTypes = new Set<CoreEvent["type"]>([
  "candidate_discovered",
  "candidate_invalid",
  "extension_registered",
  "extension_handshake",
  "extension_ready",
  "extension_manual_lease",
  "extension_starting",
  "extension_started",
  "extension_stopping",
  "extension_stopped",
  "extension_failed",
  "capability_registered",
  "capability_unregistered",
]);

type ManualLease = {
  extensionId: string;
  acquired: boolean;
};

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

async function ensureDatabaseDirectory(path: string) {
  if (!path || path === ":memory:") return;
  await mkdir(dirname(path), { recursive: true });
}

function parseManualLease(value: unknown): ManualLease | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const object = value as Record<string, unknown>;
  if (
    object.type !== "extension_manual_lease" ||
    typeof object.extensionId !== "string" ||
    typeof object.acquired !== "boolean"
  ) {
    return undefined;
  }
  return {
    extensionId: object.extensionId,
    acquired: object.acquired,
  };
}

export function defaultStoragePath() {
  const home = Bun.env.HOME ?? Bun.env.USERPROFILE;
  if (!home) throw new Error("Unable to determine the user home directory");
  const normalized = home.replaceAll("\\", "/");
  return `${normalized}${normalized.endsWith("/") ? "" : "/"}.aria/host.db`;
}

export type EventStoreOptions = {
  path: string;
  intervalMs: number;
  onFlushError: (error: Error) => void;
};

/** Buffers selected Core events in memory and periodically flushes them to SQLite. */
export class CoreEventStore {
  private readonly database: Database;
  private readonly pending: CoreEvent[] = [];
  private readonly onFlushError: (error: Error) => void;
  private readonly timer: ReturnType<typeof setInterval>;
  private closed = false;

  private constructor(database: Database, options: EventStoreOptions) {
    this.database = database;
    this.onFlushError = options.onFlushError;
    this.timer = setInterval(() => {
      try {
        this.flush();
      } catch (error) {
        this.onFlushError(asError(error));
      }
    }, options.intervalMs);
  }

  static async open(options: EventStoreOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error("Persistence interval must be greater than zero");
    }
    await ensureDatabaseDirectory(options.path);
    const database = new Database(options.path, {
      create: true,
      strict: true,
    });
    try {
      database.run("PRAGMA journal_mode = WAL");
      database.run(`
        CREATE TABLE IF NOT EXISTS events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          payload TEXT NOT NULL
        )
      `);
      return new CoreEventStore(database, options);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  append(event: CoreEvent) {
    if (!journaledEventTypes.has(event.type)) return;
    if (this.closed) throw new Error("Core event store is closed");
    this.pending.push(event);
  }

  getManualLeases() {
    const leases = new Set<string>();
    const rows = this.database
      .query<{ payload: string }, []>(
        `
          SELECT payload
          FROM events
          WHERE event_type = 'extension_manual_lease'
          ORDER BY sequence
        `,
      )
      .all();

    for (const row of rows) {
      let value: unknown;
      try {
        value = JSON.parse(row.payload);
      } catch {
        continue;
      }
      const lease = parseManualLease(value);
      if (!lease) continue;
      if (lease.acquired) leases.add(lease.extensionId);
      else leases.delete(lease.extensionId);
    }

    return leases;
  }

  flush() {
    if (this.closed) throw new Error("Core event store is closed");
    if (this.pending.length === 0) return;

    const events = this.pending.splice(0);
    try {
      const insert = this.database.prepare(
        `
          INSERT INTO events (event_id, event_type, occurred_at, payload)
          VALUES ($event_id, $event_type, $occurred_at, $payload)
        `,
      );
      const write = this.database.transaction((entries: CoreEvent[]) => {
        for (const event of entries) {
          insert.run({
            event_id: crypto.randomUUID(),
            event_type: event.type,
            occurred_at: Date.now(),
            payload: JSON.stringify(event),
          });
        }
      });
      write.immediate(events);
    } catch (error) {
      this.pending.unshift(...events);
      throw error;
    }
  }

  close() {
    if (this.closed) return;
    clearInterval(this.timer);
    try {
      this.flush();
    } finally {
      this.closed = true;
      this.database.close();
    }
  }
}
