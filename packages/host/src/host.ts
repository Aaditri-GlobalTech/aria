import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ExtensionRuntime, type ExtensionRuntimeOptions } from "@aria/core";
import {
  type CapabilityRequestParams,
  createJsonRpcError,
  createJsonRpcResult,
  createRuntimeEventNotification,
  type ExtensionRequestParams,
  HOST_METHODS,
  HOST_NOTIFICATIONS,
  type HostRequest,
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  type JsonRpcTransport,
  PROTOCOL_VERSION,
  JsonRpcProtocolError as ProtocolError,
  parseHostRequestLine,
  serializeJsonRpcMessage,
} from "@aria/protocol";

/** Lifecycle state of an embedded extension host. */
export type HostState = "idle" | "running" | "stopping" | "stopped";

function defaultAriaDirectory(): string {
  const home = Bun.env.HOME ?? Bun.env.USERPROFILE;
  if (!home) throw new Error("Unable to determine the user home directory");
  return join(home, ".aria");
}

/** Configuration for an embedded extension host. */
export type ExtensionHostOptions = {
  /** Use an existing runtime instead of creating one. */
  runtime?: ExtensionRuntime;
  /** Explicit extension files or package directories for the runtime. */
  extensionSources?: ExtensionRuntimeOptions["extensionSources"];
  /** Replaces the runtime's default module loader. */
  moduleLoader?: ExtensionRuntimeOptions["moduleLoader"];
  /** Bootstrap module used for worker and child extensions. */
  bootstrapPath?: ExtensionRuntimeOptions["bootstrapPath"];
  /** Maximum time to wait for remote extension handshakes. */
  handshakeTimeoutMs?: ExtensionRuntimeOptions["handshakeTimeoutMs"];
  /** Maximum time to wait for remote extension calls. */
  requestTimeoutMs?: ExtensionRuntimeOptions["requestTimeoutMs"];
  /** Directory for extension host storage; defaults to ~/.aria. */
  ariaDirectory?: string;
  /** JSON-RPC transport used by the host; this option is required. */
  transport: JsonRpcTransport;
  /** Receives host diagnostics; failures in this callback are ignored. */
  onError?: (error: Error) => void;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  return asError(error).message.replace(/\s+/g, " ").trim();
}

/**
 * Embeds an extension runtime behind a bidirectional JSON-RPC transport.
 *
 * Starting the host opens storage and the transport; the runtime is initialized
 * when the first `initialize` or `extension.list` request is handled.
 */
export class ExtensionHost {
  /** Runtime instance owned by this host. */
  readonly runtime: ExtensionRuntime;

  private readonly transport: JsonRpcTransport;
  private readonly onError?: (error: Error) => void;
  private readonly ariaDirectory?: string;
  private readonly removeRuntimeListener: () => void;
  private removeTransportListeners?: () => void;
  private database?: Database;
  private recoveryPromise?: Promise<void>;
  private writeTail = Promise.resolve();
  private stopPromise?: Promise<void>;
  private currentState: HostState = "idle";

  /** Create a host; callers must provide the transport it should serve. */
  constructor(options: ExtensionHostOptions) {
    if (!options.transport) {
      throw new Error("Extension host transport is required");
    }
    this.runtime =
      options.runtime ??
      new ExtensionRuntime({
        extensionSources: options.extensionSources,
        moduleLoader: options.moduleLoader,
        bootstrapPath: options.bootstrapPath,
        handshakeTimeoutMs: options.handshakeTimeoutMs,
        requestTimeoutMs: options.requestTimeoutMs,
      });
    this.transport = options.transport;
    this.onError = options.onError;
    this.ariaDirectory = options.ariaDirectory;
    this.removeRuntimeListener = this.runtime.events.on("*", (event) => {
      void this.write(createRuntimeEventNotification(event)).catch((error) =>
        this.reportError(error),
      );
    });
  }

  /** Current host lifecycle state. */
  get state(): HostState {
    return this.currentState;
  }

  /** Open host storage and begin accepting transport messages. */
  async start(): Promise<void> {
    if (this.currentState === "running") return;
    if (this.currentState === "stopping" || this.currentState === "stopped") {
      throw new Error("Extension host has stopped");
    }

    await this.openStorage();
    this.currentState = "running";
    const removeMessageListener = this.transport.onMessage((message) => {
      void this.handleLine(message).catch((error) => this.reportError(error));
    });
    const removeErrorListener = this.transport.onError((error) => {
      this.reportError(error);
      if (this.currentState === "running") {
        void this.stop().catch((stopError) => this.reportError(stopError));
      }
    });
    const removeCloseListener = this.transport.onClose(() => {
      if (this.currentState === "running") {
        void this.stop().catch((error) => this.reportError(error));
      }
    });
    this.removeTransportListeners = () => {
      removeMessageListener();
      removeErrorListener();
      removeCloseListener();
      this.removeTransportListeners = undefined;
    };
  }

  /** Shut down the runtime, close the transport, and close host storage. */
  stop(): Promise<void> {
    return this.stopRuntime()
      .then(() => this.writeTail)
      .then(() => this.closeTransport())
      .finally(() => this.closeStorage());
  }

  private stopRuntime(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopOnce();
    return this.stopPromise;
  }

  private async stopOnce(): Promise<void> {
    if (this.currentState === "stopped") return;
    this.currentState = "stopping";
    this.removeTransportListeners?.();
    try {
      await this.runtime.dispatch({ type: "shutdown" });
      this.clearManualLeases();
    } finally {
      this.removeRuntimeListener();
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
      if (request.method === "host.shutdown") {
        await this.closeTransport();
        this.closeStorage();
      }
    }
  }

  private async dispatch(request: HostRequest): Promise<unknown> {
    switch (request.method) {
      case "initialize": {
        const discovery = await this.runtime.dispatch({ type: "initialize" });
        await this.recoverManualLeases();
        return {
          protocolVersion: PROTOCOL_VERSION,
          jsonRpcVersion: "2.0",
          methods: [...HOST_METHODS],
          notifications: [...HOST_NOTIFICATIONS],
          discovery,
          extensions: this.runtime.getExtensions(),
        };
      }
      case "host.ping":
        return "pong";
      case "host.shutdown":
        await this.stopRuntime();
        return null;
      case "extension.list":
        await this.runtime.dispatch({ type: "initialize" });
        await this.recoverManualLeases();
        return this.runtime.getExtensions();
      case "capability.request": {
        const { capability, payload } =
          request.params as CapabilityRequestParams;
        return this.runtime.dispatch({
          type: "request",
          capability,
          payload,
        });
      }
      case "extension.start": {
        const { extensionId } = request.params as ExtensionRequestParams;
        await this.runtime.dispatch({ type: "start", extensionId });
        this.updateManualLease(extensionId, true);
        return null;
      }
      case "extension.stop": {
        const { extensionId } = request.params as ExtensionRequestParams;
        await this.runtime.dispatch({ type: "stop", extensionId });
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
        await this.runtime.dispatch({ type: "start", extensionId });
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

  private write(message: Parameters<typeof serializeJsonRpcMessage>[0]) {
    let encoded: string;
    try {
      encoded = serializeJsonRpcMessage(message);
    } catch (error) {
      return Promise.reject(error);
    }

    const write = this.writeTail.then(() => this.transport.send(encoded));
    this.writeTail = write.catch((error) => this.reportError(error));
    return write;
  }

  private async closeTransport(): Promise<void> {
    try {
      await this.transport.close();
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    try {
      this.onError?.(asError(error));
    } catch {
      // Diagnostics must not break the host transport.
    }
  }
}
