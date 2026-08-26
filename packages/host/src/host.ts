import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { type CoreOptions, CoreRuntime } from "@aria/core";
import {
  type CoreRequestParams,
  createCoreEventNotification,
  createJsonRpcError,
  createJsonRpcResult,
  type ExtensionRequestParams,
  HOST_METHODS,
  HOST_NOTIFICATIONS,
  type HostRequest,
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  PROTOCOL_VERSION,
  JsonRpcProtocolError as ProtocolError,
  parseHostRequestLine,
  serializeJsonRpcLine,
} from "@aria/protocol";

export type HostState = "idle" | "running" | "stopping" | "stopped";

function defaultAriaDirectory(): string {
  const home = Bun.env.HOME ?? Bun.env.USERPROFILE;
  if (!home) throw new Error("Unable to determine the user home directory");
  return join(home, ".aria");
}

export type CoreHostOptions = {
  core?: CoreRuntime;
  extensionSources?: CoreOptions["extensionSources"];
  moduleLoader?: CoreOptions["moduleLoader"];
  bootstrapPath?: CoreOptions["bootstrapPath"];
  handshakeTimeoutMs?: CoreOptions["handshakeTimeoutMs"];
  requestTimeoutMs?: CoreOptions["requestTimeoutMs"];
  /** Directory for Host storage; defaults to ~/.aria. */
  ariaDirectory?: string;
  input?: Readable;
  output?: Writable;
  onError?: (error: Error) => void;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return asError(error).message.replace(/\s+/g, " ").trim();
}

export class CoreHost {
  readonly core: CoreRuntime;

  private readonly input: Readable;
  private readonly output: Writable;
  private readonly onError?: (error: Error) => void;
  private readonly ariaDirectory?: string;
  private readonly removeCoreListener: () => void;
  private lines?: Interface;
  private database?: Database;
  private recoveryPromise?: Promise<void>;
  private writeTail = Promise.resolve();
  private stopPromise?: Promise<void>;
  private currentState: HostState = "idle";

  constructor(options: CoreHostOptions = {}) {
    this.core =
      options.core ??
      new CoreRuntime({
        extensionSources: options.extensionSources,
        moduleLoader: options.moduleLoader,
        bootstrapPath: options.bootstrapPath,
        handshakeTimeoutMs: options.handshakeTimeoutMs,
        requestTimeoutMs: options.requestTimeoutMs,
      });
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.onError = options.onError;
    this.ariaDirectory = options.ariaDirectory;
    this.removeCoreListener = this.core.events.on("*", (event) => {
      void this.write(createCoreEventNotification(event)).catch((error) =>
        this.reportError(error),
      );
    });
  }

  get state(): HostState {
    return this.currentState;
  }

  async start(): Promise<void> {
    if (this.currentState === "running") return;
    if (this.currentState === "stopping" || this.currentState === "stopped") {
      throw new Error("Core host has stopped");
    }

    await this.openStorage();
    this.currentState = "running";
    this.lines = createInterface({
      input: this.input,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.lines.on("line", (line) => {
      void this.handleLine(line).catch((error) => this.reportError(error));
    });
    this.lines.once("close", () => {
      if (this.currentState === "running") {
        void this.stop().catch((error) => this.reportError(error));
      }
    });
    this.input.once("error", (error) => {
      this.reportError(error);
      void this.stop().catch((stopError) => this.reportError(stopError));
    });
  }

  stop(): Promise<void> {
    return this.stopCore()
      .then(() => this.writeTail)
      .finally(() => this.closeStorage());
  }

  private stopCore(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopOnce();
    return this.stopPromise;
  }

  private async stopOnce(): Promise<void> {
    if (this.currentState === "stopped") return;
    this.currentState = "stopping";
    this.lines?.close();
    try {
      await this.core.dispatch({ type: "shutdown" });
      this.clearManualLeases();
    } finally {
      this.removeCoreListener();
      this.currentState = "stopped";
    }
  }

  private async handleLine(line: string): Promise<void> {
    let request: HostRequest;
    try {
      request = parseHostRequestLine(line);
    } catch (error) {
      const protocolError = this.protocolError(error);
      await this.write(
        createJsonRpcError(
          protocolError.id,
          protocolError.code,
          protocolError.message,
        ),
      );
      return;
    }

    try {
      const result = await this.dispatch(request);
      await this.write(createJsonRpcResult(request.id, result));
    } catch (error) {
      const protocolError = this.protocolError(error, request.id);
      await this.write(
        createJsonRpcError(
          protocolError.id,
          protocolError.code,
          protocolError.message,
        ),
      );
    } finally {
      if (request.method === "host.shutdown") this.closeStorage();
    }
  }

  private async dispatch(request: HostRequest): Promise<unknown> {
    switch (request.method) {
      case "initialize": {
        const discovery = await this.core.dispatch({ type: "initialize" });
        await this.recoverManualLeases();
        return {
          protocolVersion: PROTOCOL_VERSION,
          jsonRpcVersion: "2.0",
          methods: [...HOST_METHODS],
          notifications: [...HOST_NOTIFICATIONS],
          discovery,
          extensions: this.core.getExtensions(),
        };
      }
      case "host.ping":
        return "pong";
      case "host.shutdown":
        await this.stopCore();
        return null;
      case "core.extensions":
        await this.core.dispatch({ type: "initialize" });
        await this.recoverManualLeases();
        return this.core.getExtensions();
      case "core.request": {
        const { capability, payload } = request.params as CoreRequestParams;
        return this.core.dispatch({
          type: "request",
          capability,
          payload,
        });
      }
      case "core.start": {
        const { extensionId } = request.params as ExtensionRequestParams;
        await this.core.dispatch({ type: "start", extensionId });
        this.updateManualLease(extensionId, true);
        return null;
      }
      case "core.stop": {
        const { extensionId } = request.params as ExtensionRequestParams;
        await this.core.dispatch({ type: "stop", extensionId });
        this.updateManualLease(extensionId, false);
        return null;
      }
      default:
        throw new ProtocolError(
          JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
          `Method not found: ${request.method}`,
          request.id,
        );
    }
  }

  private protocolError(error: unknown, id: JsonRpcId = null): ProtocolError {
    if (error instanceof ProtocolError) return error;
    return new ProtocolError(
      JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      errorMessage(error),
      id,
    );
  }

  private async openStorage(): Promise<void> {
    const directory = this.ariaDirectory ?? defaultAriaDirectory();
    await mkdir(join(directory, "extensions"), { recursive: true });
    const database = new Database(join(directory, "host.db"), {
      create: true,
      strict: true,
    });
    try {
      database.run(`
        CREATE TABLE IF NOT EXISTS manual_leases (
          extension_id TEXT PRIMARY KEY,
          acquired INTEGER NOT NULL
        )
      `);
      this.database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private closeStorage(): void {
    this.database?.close();
    this.database = undefined;
  }

  private recoverManualLeases(): Promise<void> {
    if (!this.recoveryPromise) {
      this.recoveryPromise = this.recoverManualLeasesOnce();
    }
    return this.recoveryPromise;
  }

  private async recoverManualLeasesOnce(): Promise<void> {
    const database = this.database;
    if (!database) throw new Error("Host storage is not open");
    const leases = database
      .query<{ extension_id: string }, []>(
        "SELECT extension_id FROM manual_leases WHERE acquired = 1",
      )
      .all();
    for (const { extension_id: extensionId } of leases) {
      try {
        await this.core.dispatch({ type: "start", extensionId });
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  private updateManualLease(extensionId: string, acquired: boolean): void {
    try {
      this.database?.run(
        `
          INSERT INTO manual_leases (extension_id, acquired)
          VALUES (?, ?)
          ON CONFLICT(extension_id) DO UPDATE SET acquired = excluded.acquired
        `,
        [extensionId, acquired ? 1 : 0],
      );
    } catch (error) {
      this.reportError(error);
    }
  }

  private clearManualLeases(): void {
    try {
      this.database?.run(
        "UPDATE manual_leases SET acquired = 0 WHERE acquired = 1",
      );
    } catch (error) {
      this.reportError(error);
    }
  }

  private write(message: Parameters<typeof serializeJsonRpcLine>[0]) {
    let line: string;
    try {
      line = serializeJsonRpcLine(message);
    } catch (error) {
      return Promise.reject(error);
    }

    const write = this.writeTail.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.output.write(line, "utf8", (error?: Error | null) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    );
    this.writeTail = write.catch((error) => this.reportError(error));
    return write;
  }

  private reportError(error: unknown): void {
    try {
      this.onError?.(asError(error));
    } catch {
      // Diagnostics must not break the host transport.
    }
  }
}
