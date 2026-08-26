import { createJsonLineReader } from "./json-lines";
import {
  CORE_PROTOCOL_VERSION,
  isWireMessage,
  type WireCommand,
  type WireMessage,
} from "./messages";
import type { ExtensionEvent, JsonValue, LogLevel } from "./types";

export type BoundaryCallbacks = {
  onEvent: (event: ExtensionEvent) => void;
  onRequest: (capability: string, payload: JsonValue) => Promise<JsonValue>;
  onSubscription: (eventType: string, subscribed: boolean) => void;
  onCapability: (name: string, registered: boolean) => void;
  onLog: (level: LogLevel, message: string, details?: JsonValue) => void;
  onFailure: (error: Error) => void;
};

export type BoundaryOptions = {
  bootstrapPath?: string;
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
};

type Endpoint = {
  send(message: WireMessage): void;
  terminate(): Promise<void>;
};

type CallMessage =
  | { type: "command"; command: WireCommand }
  | { type: "invoke"; capability: string; payload: JsonValue };

type PendingCall = {
  resolve: (value: JsonValue | undefined) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function parseLine(
  line: string,
  onMessage: (message: WireMessage) => void,
  onFailure: (error: Error) => void,
) {
  try {
    const value: unknown = JSON.parse(line);
    if (!isWireMessage(value)) throw new Error("Invalid boundary message");
    onMessage(value);
  } catch (error) {
    onFailure(asError(error));
  }
}

class ProcessEndpoint implements Endpoint {
  private readonly child: Bun.PipedSubprocess;
  private readonly onFailure: (error: Error) => void;
  private intentional = false;
  private failed = false;
  private stderr = "";

  constructor(
    bootstrapPath: string,
    entryPath: string,
    extensionId: string,
    onMessage: (message: WireMessage) => void,
    onFailure: (error: Error) => void,
  ) {
    this.onFailure = onFailure;

    const bunExecutable = Bun.which("bun") ?? process.execPath;
    this.child = Bun.spawn(
      [bunExecutable, bootstrapPath, entryPath, extensionId],
      {
        cwd: process.cwd(),
        env: Bun.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        onExit: (_subprocess, code, signal) => {
          if (this.intentional || this.failed) return;
          this.fail(
            new Error(
              this.stderr.trim() ||
                `Extension process exited${
                  code === null ? ` (${signal})` : ` (${code})`
                }`,
            ),
          );
        },
      },
    );

    const reader = createJsonLineReader((line) =>
      parseLine(line, onMessage, (error) => this.fail(error)),
    );
    void this.readStdout(reader);
    void this.readStderr();
  }

  send(message: WireMessage) {
    if (this.child.exitCode !== null) {
      throw new Error("Extension process is closed");
    }
    void Promise.resolve(
      this.child.stdin.write(`${JSON.stringify(message)}\n`),
    ).catch((error: unknown) => this.fail(asError(error)));
  }

  async terminate() {
    if (this.intentional) {
      await this.child.exited;
      return;
    }
    this.intentional = true;
    this.child.kill();
    await Promise.race([this.child.exited, Bun.sleep(1000)]);
  }

  private async readStdout(reader: ReturnType<typeof createJsonLineReader>) {
    const streamReader = this.child.stdout.getReader();
    try {
      while (true) {
        const result = await streamReader.read();
        if (result.done) return;
        reader.push(result.value);
      }
    } catch (error) {
      this.fail(asError(error));
    } finally {
      streamReader.releaseLock();
      reader.end();
    }
  }

  private async readStderr() {
    const decoder = new TextDecoder();
    const streamReader = this.child.stderr.getReader();
    try {
      while (true) {
        const result = await streamReader.read();
        if (result.done) break;
        this.stderr = `${this.stderr}${decoder.decode(result.value, {
          stream: true,
        })}`.slice(-4000);
      }
      this.stderr = `${this.stderr}${decoder.decode()}`.slice(-4000);
    } catch (error) {
      this.fail(asError(error));
    } finally {
      streamReader.releaseLock();
    }
  }

  private fail(error: Error) {
    if (this.failed || this.intentional) return;
    this.failed = true;
    this.onFailure(error);
  }
}

class ThreadEndpoint implements Endpoint {
  private readonly worker: Worker;
  private intentional = false;
  private failed = false;

  constructor(
    bootstrapPath: string,
    entryPath: string,
    extensionId: string,
    onMessage: (message: WireMessage) => void,
    onFailure: (error: Error) => void,
  ) {
    this.worker = new Worker(Bun.pathToFileURL(bootstrapPath), {
      type: "module",
      argv: [entryPath, extensionId, "--aria-worker"],
      ref: true,
    });
    this.worker.onmessage = (event) => {
      const value: unknown = event.data;
      if (!isWireMessage(value)) {
        this.fail(new Error("Invalid boundary message"), onFailure);
        return;
      }
      onMessage(value);
    };
    this.worker.onerror = (event) => {
      this.fail(
        new Error(event.message || "Extension worker failed"),
        onFailure,
      );
    };
  }

  send(message: WireMessage) {
    if (this.intentional) throw new Error("Extension worker is closed");
    this.worker.postMessage(message);
  }

  async terminate() {
    if (this.intentional) return;
    this.intentional = true;
    this.worker.terminate();
  }

  private fail(error: Error, onFailure: (error: Error) => void) {
    if (this.failed || this.intentional) return;
    this.failed = true;
    onFailure(error);
  }
}

export class RemoteBoundary {
  private readonly callbacks: BoundaryCallbacks;
  private readonly mode: "worker" | "child";
  private readonly entryPath: string;
  private readonly extensionId: string;
  private readonly options: Required<BoundaryOptions>;
  private endpoint?: Endpoint;
  private loaded = false;
  private failed = false;
  private closing = false;
  private loading?: Promise<void>;
  private resolveHello?: () => void;
  private rejectHello?: (error: Error) => void;
  private readonly pending = new Map<string, PendingCall>();

  constructor(
    mode: "worker" | "child",
    entryPath: string,
    extensionId: string,
    callbacks: BoundaryCallbacks,
    options: BoundaryOptions,
  ) {
    this.mode = mode;
    this.entryPath = entryPath;
    this.extensionId = extensionId;
    this.callbacks = callbacks;
    this.options = {
      bootstrapPath:
        options.bootstrapPath ??
        Bun.fileURLToPath(new URL("./bootstrap.ts", import.meta.url)),
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 5000,
      requestTimeoutMs: options.requestTimeoutMs ?? 30000,
    };
  }

  async load() {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = this.loadOnce();
    try {
      await this.loading;
    } finally {
      this.loading = undefined;
    }
  }

  async start() {
    await this.call({ type: "command", command: "start" });
  }

  async stop() {
    await this.call({ type: "command", command: "stop" });
  }

  async invoke(capability: string, payload: JsonValue) {
    const value = await this.call({ type: "invoke", capability, payload });
    if (value === undefined) return null;
    return value;
  }

  deliver(event: ExtensionEvent) {
    this.send({ type: "event", event });
  }

  async dispose() {
    const endpoint = this.endpoint;
    if (!endpoint) return;
    this.closing = true;
    try {
      if (this.loaded && !this.failed) {
        await this.call({ type: "command", command: "shutdown" });
      }
    } catch {
      // The boundary may already have exited; termination below is authoritative.
    }
    await endpoint.terminate();
    this.endpoint = undefined;
    this.loaded = false;
    this.rejectPending(new Error("Extension boundary was disposed"));
  }

  private async loadOnce() {
    const hello = new Promise<void>((resolve, reject) => {
      this.resolveHello = resolve;
      this.rejectHello = reject;
    });
    this.endpoint = this.createEndpoint();

    try {
      await this.withTimeout(hello, this.options.handshakeTimeoutMs, "hello");
      this.loaded = true;
    } catch (error) {
      await this.dispose();
      throw asError(error);
    } finally {
      this.resolveHello = undefined;
      this.rejectHello = undefined;
    }
  }

  private createEndpoint() {
    const onMessage = (message: WireMessage) => this.handleMessage(message);
    const onFailure = (error: Error) => this.fail(error);
    return this.mode === "child"
      ? new ProcessEndpoint(
          this.options.bootstrapPath,
          this.entryPath,
          this.extensionId,
          onMessage,
          onFailure,
        )
      : new ThreadEndpoint(
          this.options.bootstrapPath,
          this.entryPath,
          this.extensionId,
          onMessage,
          onFailure,
        );
  }

  private handleMessage(message: WireMessage) {
    if (message.type === "hello") {
      if (
        message.protocolVersion !== CORE_PROTOCOL_VERSION ||
        message.extensionId !== this.extensionId
      ) {
        this.fail(new Error("Extension hello handshake is invalid"));
        return;
      }
      this.resolveHello?.();
      return;
    }

    if (message.type === "response") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.success) pending.resolve(message.value);
      else pending.reject(new Error(message.error));
      return;
    }

    if (message.type === "event") {
      this.callbacks.onEvent(message.event);
      return;
    }
    if (message.type === "request") {
      void this.callbacks
        .onRequest(message.capability, message.payload)
        .then((value) => {
          this.send({ type: "response", id: message.id, success: true, value });
        })
        .catch((error: unknown) => {
          this.send({
            type: "response",
            id: message.id,
            success: false,
            error: asError(error).message,
          });
        });
      return;
    }
    if (message.type === "subscribe") {
      this.callbacks.onSubscription(message.eventType, true);
      return;
    }
    if (message.type === "unsubscribe") {
      this.callbacks.onSubscription(message.eventType, false);
      return;
    }
    if (message.type === "capability_register") {
      this.callbacks.onCapability(message.name, true);
      return;
    }
    if (message.type === "capability_unregister") {
      this.callbacks.onCapability(message.name, false);
      return;
    }
    if (message.type === "log") {
      this.callbacks.onLog(message.level, message.message, message.details);
    }
  }

  private async call(message: CallMessage) {
    if (!this.endpoint || !this.loaded) {
      throw new Error("Extension boundary is not ready");
    }

    const id = crypto.randomUUID();
    const request: WireMessage =
      message.type === "command"
        ? { type: "command", id, command: message.command }
        : {
            type: "invoke",
            id,
            capability: message.capability,
            payload: message.payload,
          };

    return new Promise<JsonValue | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension request timed out: ${message.type}`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.endpoint?.send(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(asError(error));
      }
    });
  }

  private send(message: WireMessage) {
    try {
      this.endpoint?.send(message);
    } catch (error) {
      this.fail(asError(error));
    }
  }

  private fail(error: Error) {
    if (this.failed || this.closing) return;
    this.failed = true;
    this.rejectHello?.(error);
    this.rejectPending(error);
    this.callbacks.onFailure(error);
  }

  private rejectPending(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
  ) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Extension ${label} handshake timed out`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
