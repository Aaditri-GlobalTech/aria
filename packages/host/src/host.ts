import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { type CoreOptions, type CoreRuntime, createCore } from "@aria/core";
import {
  createCoreEventNotification,
  createJsonRpcError,
  createJsonRpcResult,
  HOST_METHODS,
  HOST_NOTIFICATIONS,
  type HostRequest,
  isJsonValue,
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  PROTOCOL_VERSION,
  JsonRpcProtocolError as ProtocolError,
  parseHostRequestLine,
  serializeJsonRpcLine,
} from "@aria/protocol";

export type HostState = "idle" | "running" | "stopping" | "stopped";

export type CoreHostOptions = {
  core?: CoreRuntime;
  extensionSources?: CoreOptions["extensionSources"];
  moduleLoader?: CoreOptions["moduleLoader"];
  bootstrapPath?: CoreOptions["bootstrapPath"];
  handshakeTimeoutMs?: CoreOptions["handshakeTimeoutMs"];
  requestTimeoutMs?: CoreOptions["requestTimeoutMs"];
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

function objectParams(request: HostRequest): Record<string, unknown> {
  if (
    typeof request.params !== "object" ||
    request.params === null ||
    Array.isArray(request.params)
  ) {
    throw new ProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      `${request.method} params must be an object`,
      request.id,
    );
  }
  return request.params as Record<string, unknown>;
}

function requiredString(
  request: HostRequest,
  params: Record<string, unknown>,
  name: string,
): string {
  const value = params[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new ProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      `${name} must be a non-empty string`,
      request.id,
    );
  }
  return value;
}

export class CoreHost {
  readonly core: CoreRuntime;

  private readonly input: Readable;
  private readonly output: Writable;
  private readonly onError?: (error: Error) => void;
  private readonly removeCoreListener: () => void;
  private lines?: Interface;
  private writeTail = Promise.resolve();
  private stopPromise?: Promise<void>;
  private currentState: HostState = "idle";

  constructor(options: CoreHostOptions = {}) {
    this.core =
      options.core ??
      createCore({
        extensionSources: options.extensionSources,
        moduleLoader: options.moduleLoader,
        bootstrapPath: options.bootstrapPath,
        handshakeTimeoutMs: options.handshakeTimeoutMs,
        requestTimeoutMs: options.requestTimeoutMs,
      });
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.onError = options.onError;
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

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopOnce();
    return this.stopPromise;
  }

  private async stopOnce(): Promise<void> {
    if (this.currentState === "stopped") return;
    this.currentState = "stopping";
    this.lines?.close();
    try {
      await this.core.shutdown();
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
    }
  }

  private async dispatch(request: HostRequest): Promise<unknown> {
    switch (request.method) {
      case "initialize": {
        const discovery = await this.core.initialize();
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
        await this.stop();
        return null;
      case "core.extensions":
        await this.core.initialize();
        return this.core.getExtensions();
      case "core.request": {
        const params = objectParams(request);
        const capability = requiredString(request, params, "capability");
        const payload = params.payload;
        if (!isJsonValue(payload)) {
          throw new ProtocolError(
            JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            "payload must be a JSON value",
            request.id,
          );
        }
        return this.core.request(capability, payload);
      }
      case "core.start":
        await this.core.start(
          requiredString(request, objectParams(request), "extensionId"),
        );
        return null;
      case "core.stop":
        await this.core.stop(
          requiredString(request, objectParams(request), "extensionId"),
        );
        return null;
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

export function createHost(options: CoreHostOptions = {}): CoreHost {
  return new CoreHost(options);
}
