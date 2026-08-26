import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { ExtensionSnapshot } from "@aria/core";
import type {
  JsonRpcError,
  JsonRpcParams,
  JsonRpcRequest,
  JsonRpcTransport,
  JsonValue,
  RuntimeEvent,
} from "@aria/protocol";
import {
  HOST_METHODS,
  HOST_NOTIFICATIONS,
  JSON_RPC_VERSION,
  PROTOCOL_VERSION,
  parseJsonRpcOutboundLine,
  RUNTIME_EVENT_METHOD,
  serializeJsonRpcMessage,
  validateHostInitializeResult,
  validateRuntimeEventNotification,
} from "@aria/protocol";
import { StdioTransport } from "../src/transports";

type HostState =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "failed";

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type HostProcess = {
  command: string;
  args: string[];
  cwd: string;
  display: string;
};

type ProcessWithResourcesPath = NodeJS.Process & {
  resourcesPath?: string;
};

export type HostClientOptions = {
  onEvent?: (event: RuntimeEvent) => void;
  hostSourcePath?: string;
  hostRuntime?: string;
  hostCwd?: string;
  extensionSources?: readonly string[];
  resourcesPath?: string;
  shutdownTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Use an already-connected transport instead of spawning the Bun host. */
  transport?: JsonRpcTransport;
};

export class HostRpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcError) {
    super(`${error.message} (${error.code})`);
    this.name = "HostRpcError";
    this.code = error.code;
    this.data = error.data;
  }
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  return new Error(value === undefined ? fallback : String(value));
}

function errorText(value: unknown): string {
  return asError(value, "Unknown error").message.replace(/\s+/g, " ").trim();
}

function processExitMessage(
  stderr: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  const diagnostic = stderr.replace(/\s+/g, " ").trim();
  if (diagnostic) return diagnostic.slice(0, 500);
  return `Extension host exited${code === null ? ` (${signal ?? "unknown signal"})` : ` (${code})`}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function hostResourcesPath(options: HostClientOptions): string | undefined {
  return (
    options.resourcesPath ?? (process as ProcessWithResourcesPath).resourcesPath
  );
}

function extensionArguments(
  extensionSources: readonly string[] | undefined,
): string[] {
  return (extensionSources ?? []).flatMap((source) => [
    "--extension-source",
    source,
  ]);
}

function resolveHostProcess(options: HostClientOptions): HostProcess {
  const cwd = resolve(
    options.hostCwd ?? process.env.ARIA_HOST_CWD ?? process.cwd(),
  );
  const sourceValue =
    options.hostSourcePath ?? process.env.ARIA_HOST_SOURCE_PATH;
  const extensionArgs = extensionArguments(options.extensionSources);

  if (sourceValue) {
    const sourcePath = isAbsolute(sourceValue)
      ? sourceValue
      : resolve(cwd, sourceValue);
    if (!existsSync(sourcePath)) {
      throw new Error(`Bun host source was not found at ${sourcePath}`);
    }

    const runtime =
      options.hostRuntime ?? process.env.ARIA_HOST_RUNTIME ?? "bun";
    if (!runtime) throw new Error("Bun host runtime is not configured");
    return {
      command: runtime,
      args: ["run", sourcePath, ...extensionArgs],
      cwd,
      display: `${runtime} run ${sourcePath}`,
    };
  }

  const resourcesPath = hostResourcesPath(options);
  if (!resourcesPath) {
    throw new Error(
      "Packaged extension host path is unavailable: process.resourcesPath is not set",
    );
  }

  const executable = join(
    resourcesPath,
    "host",
    `aria-host${process.platform === "win32" ? ".exe" : ""}`,
  );
  if (!existsSync(executable)) {
    throw new Error(
      `Extension host executable was not found at ${executable}. Build the Bun host before packaging the app.`,
    );
  }

  return {
    command: executable,
    args: extensionArgs,
    cwd,
    display: executable,
  };
}

/** Owns an extension host over stdio or another JSON-RPC transport. */
export class HostClient {
  private readonly options: HostClientOptions;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly shutdownTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private child: ChildProcessWithoutNullStreams | undefined;
  private transport: JsonRpcTransport | undefined;
  private removeTransportListeners: (() => void) | undefined;
  private processExit: Promise<void> | undefined;
  private resolveProcessExit: (() => void) | undefined;
  private writeTail = Promise.resolve();
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private nextId = 1;
  private state: HostState = "idle";
  private failure: Error | undefined;
  private stderr = "";

  constructor(options: HostClientOptions = {}) {
    this.options = options;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 2000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.transport = options.transport;
  }

  get status(): HostState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === "ready") return;
    if (this.startPromise) return this.startPromise;
    if (this.state === "stopping" || this.state === "stopped") {
      throw new Error("Extension host has stopped");
    }
    if (this.state === "failed") {
      throw this.failure ?? new Error("Extension host failed");
    }

    this.state = "starting";
    this.startPromise = this.startHost();
    return this.startPromise;
  }

  async request<T = unknown>(
    capability: string,
    payload: JsonValue = null,
  ): Promise<T> {
    await this.start();
    return (await this.sendRequest("capability.request", {
      capability,
      payload,
    })) as T;
  }

  async ping(): Promise<string> {
    await this.start();
    return (await this.sendRequest("host.ping")) as string;
  }

  async extensions(): Promise<readonly ExtensionSnapshot[]> {
    await this.start();
    return (await this.sendRequest(
      "extension.list",
    )) as readonly ExtensionSnapshot[];
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.state === "idle" || this.state === "stopped") {
      this.state = "stopped";
      await this.closeTransport();
      return;
    }

    this.stopPromise = this.stopHost();
    return this.stopPromise;
  }

  private async startHost(): Promise<void> {
    let processConfig: HostProcess | undefined;
    try {
      if (this.transport) {
        this.attachTransport(this.transport);
      } else {
        processConfig = resolveHostProcess(this.options);
        const child = spawn(processConfig.command, processConfig.args, {
          cwd: processConfig.cwd,
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        this.child = child;
        this.processExit = new Promise<void>((resolveExit) => {
          this.resolveProcessExit = resolveExit;
        });
        this.transport = new StdioTransport({
          input: child.stdout,
          output: child.stdin,
        });
        this.attachTransport(this.transport);
        this.attachProcess(child);
      }

      const result = await this.sendRequest("initialize", {
        protocolVersion: PROTOCOL_VERSION,
      });
      const handshake = validateHostInitializeResult(result);
      if (!HOST_METHODS.every((method) => handshake.methods.includes(method))) {
        throw new Error(
          "Extension host does not advertise all required methods",
        );
      }
      if (
        !HOST_NOTIFICATIONS.every((notification) =>
          handshake.notifications.includes(notification),
        )
      ) {
        throw new Error(
          "Extension host does not advertise required notifications",
        );
      }
      this.state = "ready";
    } catch (error) {
      const detail = errorText(error);
      const prefix = processConfig
        ? `Unable to start extension host (${processConfig.display})`
        : "Unable to start extension host";
      const startupError = new Error(`${prefix}: ${detail}`);
      this.failure = startupError;
      this.rejectPending(startupError);
      this.state = "failed";
      await this.terminateChild();
      throw startupError;
    }
  }

  private attachTransport(transport: JsonRpcTransport): void {
    const removeMessageListener = transport.onMessage((message) =>
      this.handleLine(message),
    );
    const removeErrorListener = transport.onError((error) => {
      if (this.state === "stopping" || this.state === "stopped") return;
      this.fail(
        new Error(`Extension host transport error: ${errorText(error)}`),
      );
      void this.terminateChild();
    });
    const removeCloseListener = transport.onClose(() => {
      if (this.state === "stopping" || this.state === "stopped") return;
      if (this.child) return;
      this.fail(new Error("Extension host transport closed"));
    });
    this.removeTransportListeners = () => {
      removeMessageListener();
      removeErrorListener();
      removeCloseListener();
      this.removeTransportListeners = undefined;
    };
  }

  private attachProcess(child: ChildProcessWithoutNullStreams): void {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000);
    });

    const processError = (error: Error) => {
      if (this.state === "stopping" || this.state === "stopped") return;
      this.fail(new Error(`Extension host process error: ${error.message}`));
    };
    child.once("error", processError);
    child.stdout.once("error", processError);
    child.stdin.once("error", processError);
    child.stderr.once("error", processError);
    child.once("exit", (code, signal) => {
      this.resolveProcessExit?.();
      this.resolveProcessExit = undefined;
      if (this.child === child) this.child = undefined;

      if (this.state !== "stopping" && this.state !== "stopped") {
        this.fail(new Error(processExitMessage(this.stderr, code, signal)));
      }
    });
  }

  private handleLine(line: string): void {
    let message: ReturnType<typeof parseJsonRpcOutboundLine>;
    try {
      message = parseJsonRpcOutboundLine(line);
    } catch (error) {
      this.fail(
        new Error(`Malformed extension host output: ${errorText(error)}`),
      );
      void this.terminateChild();
      return;
    }

    if ("method" in message) {
      if (message.method !== RUNTIME_EVENT_METHOD) {
        this.fail(
          new Error(
            `Unexpected extension host notification: ${message.method}`,
          ),
        );
        void this.terminateChild();
        return;
      }
      try {
        const notification = validateRuntimeEventNotification(message);
        this.options.onEvent?.(notification.params);
      } catch (error) {
        this.fail(
          new Error(
            `Malformed runtime event notification: ${errorText(error)}`,
          ),
        );
        void this.terminateChild();
      }
      return;
    }

    if (typeof message.id !== "number" || !Number.isSafeInteger(message.id)) {
      this.fail(new Error("Extension host returned an invalid response id"));
      void this.terminateChild();
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) {
      this.fail(`Unexpected extension host response id: ${message.id}`);
      void this.terminateChild();
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if ("error" in message) request.reject(new HostRpcError(message.error));
    else request.resolve(message.result);
  }

  private sendRequest(
    method: string,
    params?: JsonRpcParams,
  ): Promise<unknown> {
    if (!this.transport || this.state === "failed") {
      return Promise.reject(
        this.failure ?? new Error("Extension host is unavailable"),
      );
    }

    const id = this.nextId;
    this.nextId += 1;
    const request = new Promise<unknown>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        rejectRequest(new Error(`Extension host request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      });
    });
    const message: JsonRpcRequest = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    void this.write(message).catch((error) => {
      if (!this.pending.has(id)) return;
      const reason = asError(error, "Unable to write to extension host");
      this.fail(reason);
    });
    return request;
  }

  private write(message: JsonRpcRequest): Promise<void> {
    let encoded: string;
    try {
      encoded = serializeJsonRpcMessage(message);
    } catch (error) {
      return Promise.reject(
        asError(error, "Unable to serialize extension host request"),
      );
    }

    const transport = this.transport;
    if (!transport) {
      return Promise.reject(
        new Error("Extension host transport is unavailable"),
      );
    }
    const write = this.writeTail.then(() => transport.send(encoded));
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  private fail(error: unknown): void {
    const reason = asError(error, "Extension host failed");
    if (!this.failure) this.failure = reason;
    this.rejectPending(this.failure);
    if (this.state !== "stopping" && this.state !== "stopped") {
      this.state = "failed";
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private async stopHost(): Promise<void> {
    if (this.state === "starting" && this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }

    const child = this.child;
    const transport = this.transport;
    if (!child && !transport) {
      this.rejectPending(new Error("Extension host stopped"));
      this.state = "stopped";
      return;
    }

    const canRequestShutdown =
      this.state === "ready" &&
      (child === undefined || (child.exitCode === null && !child.killed));
    this.state = "stopping";
    let shutdownError: Error | undefined;

    if (canRequestShutdown) {
      try {
        await Promise.race([
          this.sendRequest("host.shutdown"),
          wait(this.shutdownTimeoutMs).then(() => {
            throw new Error("Timed out waiting for extension host shutdown");
          }),
        ]);
        await this.writeTail;
      } catch (error) {
        shutdownError = asError(error, "Unable to shut down extension host");
      }
    }

    this.rejectPending(shutdownError ?? new Error("Extension host stopped"));
    if (child) {
      await this.waitForExit(this.shutdownTimeoutMs);
      if (child.exitCode === null) {
        child.kill();
        await this.waitForExit(250);
      }
    }
    this.removeTransportListeners?.();
    await this.closeTransport();
    this.child = undefined;
    this.state = "stopped";

    if (shutdownError) throw shutdownError;
  }

  private async terminateChild(): Promise<void> {
    const child = this.child;
    if (child) {
      if (child.exitCode === null) child.kill();
      await this.waitForExit(250);
      if (this.child === child) this.child = undefined;
    }
    await this.closeTransport();
  }

  private async closeTransport(): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    this.removeTransportListeners?.();
    this.transport = undefined;
    await transport.close().catch(() => undefined);
  }

  private async waitForExit(milliseconds: number): Promise<void> {
    if (!this.child || this.child.exitCode !== null) return;
    const exit = this.processExit;
    if (!exit) return;
    await Promise.race([exit, wait(milliseconds)]);
  }
}

export type HostClientApi = Pick<HostClient, "ping" | "extensions" | "request">;
