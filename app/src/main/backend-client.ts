import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type {
  AgentManagerEvent,
  JsonRpcError,
  JsonRpcParams,
  JsonRpcRequest,
} from "@aria/protocol";
import {
  AGENT_EVENT_METHOD,
  HOST_METHODS,
  JSON_RPC_VERSION,
  PROTOCOL_VERSION,
  parseJsonRpcOutboundLine,
  serializeJsonRpcLine,
  validateAgentEventNotification,
  validateHostInitializeResult,
} from "@aria/protocol";

type BackendState =
  | "idle"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "failed";

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type BackendProcess = {
  command: string;
  args: string[];
  cwd: string;
  display: string;
};

type ProcessWithResourcesPath = NodeJS.Process & {
  resourcesPath?: string;
};

export type BackendClientOptions = {
  onEvent?: (event: AgentManagerEvent) => void;
  hostSourcePath?: string;
  hostRuntime?: string;
  hostCwd?: string;
  resourcesPath?: string;
  shutdownTimeoutMs?: number;
};

export class BackendRpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(error: JsonRpcError) {
    super(`${error.message} (${error.code})`);
    this.name = "BackendRpcError";
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
  return `Backend exited${code === null ? ` (${signal ?? "unknown signal"})` : ` (${code})`}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function hostResourcesPath(options: BackendClientOptions): string | undefined {
  return (
    options.resourcesPath ?? (process as ProcessWithResourcesPath).resourcesPath
  );
}

function resolveBackendProcess(options: BackendClientOptions): BackendProcess {
  const cwd = resolve(
    options.hostCwd ?? process.env.ARIA_HOST_CWD ?? process.cwd(),
  );
  const sourceValue =
    options.hostSourcePath ?? process.env.ARIA_HOST_SOURCE_PATH;

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
      args: ["run", sourcePath],
      cwd,
      display: `${runtime} run ${sourcePath}`,
    };
  }

  const resourcesPath = hostResourcesPath(options);
  if (!resourcesPath) {
    throw new Error(
      "Packaged Aria backend path is unavailable: process.resourcesPath is not set",
    );
  }

  const executable = join(
    resourcesPath,
    "backend",
    `aria-backend${process.platform === "win32" ? ".exe" : ""}`,
  );
  if (!existsSync(executable)) {
    throw new Error(
      `Aria backend executable was not found at ${executable}. Build the Bun sidecar before packaging the app (Phase 5).`,
    );
  }

  return {
    command: executable,
    args: [],
    cwd,
    display: executable,
  };
}

/** Owns the Bun sidecar and its newline-delimited JSON-RPC stream. */
export class BackendClient {
  private readonly options: BackendClientOptions;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly shutdownTimeoutMs: number;
  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: Interface | undefined;
  private processExit: Promise<void> | undefined;
  private resolveProcessExit: (() => void) | undefined;
  private writeTail = Promise.resolve();
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private nextId = 1;
  private state: BackendState = "idle";
  private failure: Error | undefined;
  private stderr = "";

  constructor(options: BackendClientOptions = {}) {
    this.options = options;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 2000;
  }

  get status(): BackendState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === "ready") return;
    if (this.startPromise) return this.startPromise;
    if (this.state === "stopping" || this.state === "stopped") {
      throw new Error("Aria backend has stopped");
    }
    if (this.state === "failed") {
      throw this.failure ?? new Error("Aria backend failed");
    }

    this.state = "starting";
    this.startPromise = this.startBackend();
    return this.startPromise;
  }

  async request<T = unknown>(
    method: string,
    params?: JsonRpcParams,
  ): Promise<T> {
    await this.start();
    return (await this.sendRequest(method, params)) as T;
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.state === "idle" || this.state === "stopped") {
      this.state = "stopped";
      return;
    }

    this.stopPromise = this.stopBackend();
    return this.stopPromise;
  }

  private async startBackend(): Promise<void> {
    let processConfig: BackendProcess | undefined;
    try {
      processConfig = resolveBackendProcess(this.options);
      const child = spawn(processConfig.command, processConfig.args, {
        cwd: processConfig.cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      this.processExit = new Promise<void>((resolveExit) => {
        this.resolveProcessExit = resolveExit;
      });
      this.attachProcess(child);

      const result = await this.sendRequest("initialize", {
        protocolVersion: PROTOCOL_VERSION,
      });
      const handshake = validateHostInitializeResult(result);
      if (!HOST_METHODS.every((method) => handshake.methods.includes(method))) {
        throw new Error("Aria backend does not advertise all required methods");
      }
      if (!handshake.notifications.includes(AGENT_EVENT_METHOD)) {
        throw new Error("Aria backend does not advertise agent.event");
      }
      this.state = "ready";
    } catch (error) {
      const detail = errorText(error);
      const prefix = processConfig
        ? `Unable to start Aria backend (${processConfig.display})`
        : "Unable to start Aria backend";
      const startupError = new Error(`${prefix}: ${detail}`);
      this.failure = startupError;
      this.rejectPending(startupError);
      this.state = "failed";
      await this.terminateChild();
      throw startupError;
    }
  }

  private attachProcess(child: ChildProcessWithoutNullStreams): void {
    this.lines = createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.lines.on("line", (line) => this.handleLine(line));

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000);
    });

    const processError = (error: Error) => {
      if (this.state === "stopping" || this.state === "stopped") return;
      this.fail(new Error(`Aria backend process error: ${error.message}`));
    };
    child.once("error", processError);
    child.stdout.once("error", processError);
    child.stdin.once("error", processError);
    child.stderr.once("error", processError);
    child.once("exit", (code, signal) => {
      this.lines?.close();
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
        new Error(`Malformed Aria backend output: ${errorText(error)}`),
      );
      void this.terminateChild();
      return;
    }

    if ("method" in message) {
      if (message.method !== AGENT_EVENT_METHOD) {
        this.fail(
          new Error(`Unexpected Aria backend notification: ${message.method}`),
        );
        void this.terminateChild();
        return;
      }
      try {
        const notification = validateAgentEventNotification(message);
        this.options.onEvent?.(notification.params);
      } catch (error) {
        this.fail(
          new Error(`Malformed Aria backend notification: ${errorText(error)}`),
        );
        void this.terminateChild();
      }
      return;
    }

    if (typeof message.id !== "number" || !Number.isSafeInteger(message.id)) {
      this.fail(new Error("Aria backend returned an invalid response id"));
      void this.terminateChild();
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) {
      this.fail(`Unexpected Aria backend response id: ${message.id}`);
      void this.terminateChild();
      return;
    }
    this.pending.delete(message.id);
    if ("error" in message) request.reject(new BackendRpcError(message.error));
    else request.resolve(message.result);
  }

  private sendRequest(
    method: string,
    params?: JsonRpcParams,
  ): Promise<unknown> {
    const child = this.child;
    if (!child || child.stdin.destroyed || this.state === "failed") {
      return Promise.reject(
        this.failure ?? new Error("Aria backend is unavailable"),
      );
    }

    const id = this.nextId;
    this.nextId += 1;
    const request = new Promise<unknown>((resolveRequest, rejectRequest) => {
      this.pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
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
      const reason = asError(error, "Unable to write to Aria backend");
      this.fail(reason);
    });
    return request;
  }

  private write(message: JsonRpcRequest): Promise<void> {
    let line: string;
    try {
      line = serializeJsonRpcLine(message);
    } catch (error) {
      return Promise.reject(
        asError(error, "Unable to serialize backend request"),
      );
    }

    const write = this.writeTail.then(
      () =>
        new Promise<void>((resolveWrite, rejectWrite) => {
          const child = this.child;
          if (!child || child.stdin.destroyed || child.stdin.writableEnded) {
            rejectWrite(new Error("Aria backend stdin is closed"));
            return;
          }
          child.stdin.write(line, "utf8", (error) => {
            if (error) rejectWrite(error);
            else resolveWrite();
          });
        }),
    );
    this.writeTail = write.catch(() => undefined);
    return write;
  }

  private fail(error: unknown): void {
    const reason = asError(error, "Aria backend failed");
    if (!this.failure) this.failure = reason;
    this.rejectPending(this.failure);
    if (this.state !== "stopping" && this.state !== "stopped") {
      this.state = "failed";
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private async stopBackend(): Promise<void> {
    if (this.state === "starting" && this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }

    const child = this.child;
    if (!child) {
      this.rejectPending(new Error("Aria backend stopped"));
      this.state = "stopped";
      return;
    }

    const canRequestShutdown =
      this.state === "ready" && child.exitCode === null && !child.killed;
    this.state = "stopping";
    let shutdownError: Error | undefined;

    if (canRequestShutdown) {
      try {
        await Promise.race([
          this.sendRequest("host.shutdown"),
          wait(this.shutdownTimeoutMs).then(() => {
            throw new Error("Timed out waiting for Aria backend shutdown");
          }),
        ]);
        await this.writeTail;
      } catch (error) {
        shutdownError = asError(error, "Unable to shut down Aria backend");
      }
    }

    this.rejectPending(shutdownError ?? new Error("Aria backend stopped"));
    await this.waitForExit(this.shutdownTimeoutMs);
    if (child.exitCode === null) {
      child.kill();
      await this.waitForExit(250);
    }
    this.lines?.close();
    this.child = undefined;
    this.state = "stopped";

    if (shutdownError) throw shutdownError;
  }

  private async terminateChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    if (child.exitCode === null) child.kill();
    await this.waitForExit(250);
    this.lines?.close();
    if (this.child === child) this.child = undefined;
  }

  private async waitForExit(milliseconds: number): Promise<void> {
    if (!this.child || this.child.exitCode !== null) return;
    const exit = this.processExit;
    if (!exit) return;
    await Promise.race([exit, wait(milliseconds)]);
  }
}
