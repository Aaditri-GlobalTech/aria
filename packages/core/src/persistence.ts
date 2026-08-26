import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CoreEvent } from "./types";

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

/** Buffers manual lease state updates in memory and periodically flushes them to SQLite. */
export class CoreEventStore {
  private readonly database: Database;
  private readonly pending: ManualLease[] = [];
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
        CREATE TABLE IF NOT EXISTS manual_leases (
          extension_id TEXT PRIMARY KEY,
          acquired INTEGER NOT NULL
        )
      `);
      return new CoreEventStore(database, options);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  append(event: CoreEvent) {
    if (event.type !== "extension_manual_lease") return;
    if (this.closed) throw new Error("Core event store is closed");
    this.pending.push({
      extensionId: event.extensionId,
      acquired: event.acquired,
    });
  }

  getManualLeases() {
    const rows = this.database
      .query<{ extension_id: string }, []>(
        "SELECT extension_id FROM manual_leases WHERE acquired = 1",
      )
      .all();
    return new Set(rows.map(({ extension_id }) => extension_id));
  }

  flush() {
    if (this.closed) throw new Error("Core event store is closed");
    if (this.pending.length === 0) return;

    const leases = this.pending.splice(0);
    try {
      const upsert = this.database.prepare(
        `
          INSERT INTO manual_leases (extension_id, acquired)
          VALUES ($extension_id, $acquired)
          ON CONFLICT(extension_id) DO UPDATE SET acquired = excluded.acquired
        `,
      );
      const write = this.database.transaction((entries: ManualLease[]) => {
        for (const lease of entries) {
          upsert.run({
            extension_id: lease.extensionId,
            acquired: lease.acquired ? 1 : 0,
          });
        }
      });
      write.immediate(leases);
    } catch (error) {
      this.pending.unshift(...leases);
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
