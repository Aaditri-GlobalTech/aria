import { Database } from "bun:sqlite";
import { $ } from "bun";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { JsonValueSchema } from "./schemas";
import type { CoreEvent, JsonObject, JsonValue } from "./types";

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

const StoredCoreEventSchema = Type.Object({
  eventId: Type.String(),
  eventType: Type.String(),
  occurredAt: Type.Integer(),
  payload: JsonValueSchema,
});

type StoredCoreEvent = {
  eventId: string;
  eventType: string;
  occurredAt: number;
  payload: JsonValue;
};

type EventRow = {
  event_id: string;
  event_type: string;
  occurred_at: number;
  payload: string;
};

type ManualLease = {
  extensionId: string;
  acquired: boolean;
};

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function parentDirectory(path: string) {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0) return ".";
  if (separator === 0) return path.slice(0, 1);
  return path.slice(0, separator);
}

async function ensureDatabaseDirectory(path: string) {
  if (!path || path === ":memory:") return;
  await $`mkdir -p ${parentDirectory(path)}`.quiet();
}

function parseStoredEvent(row: EventRow): StoredCoreEvent | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return undefined;
  }

  const value: unknown = {
    eventId: row.event_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    payload,
  };
  if (!Value.Check(StoredCoreEventSchema, value)) return undefined;
  return value as StoredCoreEvent;
}

function parseManualLease(value: JsonValue): ManualLease | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const object = value as JsonObject;
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
    const leases = new Map<string, boolean>();
    const rows = this.database
      .query<EventRow, []>(
        `
          SELECT event_id, event_type, occurred_at, payload
          FROM events
          WHERE event_type = 'extension_manual_lease'
          ORDER BY sequence
        `,
      )
      .all();

    for (const row of rows) {
      const stored = parseStoredEvent(row);
      if (!stored) continue;
      const lease = parseManualLease(stored.payload);
      if (lease) leases.set(lease.extensionId, lease.acquired);
    }

    return new Set(
      [...leases.entries()]
        .filter(([, acquired]) => acquired)
        .map(([extensionId]) => extensionId),
    );
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
