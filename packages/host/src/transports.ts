import { createConnection } from "node:net";
import { createInterface, type Interface } from "node:readline";
import type { Duplex, Readable, Writable } from "node:stream";
import type {
  JsonRpcTransport,
  TransportCloseListener,
  TransportErrorListener,
  TransportMessageListener,
} from "@aria/protocol";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function removeListener<T>(listeners: Set<T>, listener: T): void {
  listeners.delete(listener);
}

/** Node stream adapter that frames each JSON-RPC message as one line. */
export class StdioTransport implements JsonRpcTransport {
  private readonly lines: Interface;
  private readonly messages = new Set<TransportMessageListener<string>>();
  private readonly errors = new Set<TransportErrorListener>();
  private readonly closes = new Set<TransportCloseListener>();
  private closed = false;
  private closeNotified = false;

  /** Read from `input` and write newline-delimited messages to `output`. */
  constructor(options: { input: Readable; output: Writable }) {
    this.lines = createInterface({
      input: options.input,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.lines.on("line", (line) => this.emitMessage(line));
    this.lines.once("close", () => this.markClosed());
    options.input.on("error", (error) => this.emitError(error));
    options.output.on("error", (error) => this.emitError(error));
    this.output = options.output;
  }

  private readonly output: Writable;

  send(message: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Transport is closed"));

    return new Promise((resolve, reject) => {
      try {
        this.output.write(`${message}\n`, "utf8", (error?: Error | null) => {
          if (!error) {
            resolve();
            return;
          }
          const reason = asError(error);
          this.emitError(reason);
          reject(reason);
        });
      } catch (error) {
        const reason = asError(error);
        this.emitError(reason);
        reject(reason);
      }
    });
  }

  onMessage(listener: TransportMessageListener<string>): () => void {
    this.messages.add(listener);
    return () => removeListener(this.messages, listener);
  }

  onError(listener: TransportErrorListener): () => void {
    this.errors.add(listener);
    return () => removeListener(this.errors, listener);
  }

  onClose(listener: TransportCloseListener): () => void {
    if (this.closeNotified) {
      listener();
      return () => undefined;
    }
    this.closes.add(listener);
    return () => removeListener(this.closes, listener);
  }

  async close(): Promise<void> {
    if (this.closeNotified) return;
    this.closed = true;
    this.lines.close();
    this.markClosed();
  }

  private emitMessage(message: string): void {
    if (this.closed) return;
    for (const listener of new Set(this.messages)) {
      try {
        listener(message);
      } catch (error) {
        this.emitError(error);
      }
    }
  }

  private emitError(error: unknown): void {
    const reason = asError(error);
    for (const listener of new Set(this.errors)) {
      try {
        listener(reason);
      } catch {
        // Transport observers must not break delivery to other observers.
      }
    }
  }

  private markClosed(): void {
    if (this.closeNotified) return;
    this.closed = true;
    this.closeNotified = true;
    for (const listener of new Set(this.closes)) {
      try {
        listener();
      } catch (error) {
        this.emitError(error);
      }
    }
  }
}

/**
 * Newline-framed adapter for a connected Unix-domain socket or Windows named
 * pipe. Node's net API uses the same Socket type for both.
 */
export class LocalSocketTransport extends StdioTransport {
  private readonly socket: Duplex;

  /** Wrap an already-connected socket or named pipe. */
  constructor(socket: Duplex) {
    super({ input: socket, output: socket });
    this.socket = socket;
  }

  override async close(): Promise<void> {
    await super.close();
    this.socket.destroy();
  }
}

/** Connect to a Unix-domain socket or Windows named-pipe path. */
export function connectLocalSocket(
  path: string,
): Promise<LocalSocketTransport> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.removeListener("error", onError);
      resolve(new LocalSocketTransport(socket));
    });
  });
}

/** Adapter for an open, browser-compatible text WebSocket connection. */
export class WebSocketTransport implements JsonRpcTransport {
  private readonly messages = new Set<TransportMessageListener<string>>();
  private readonly errors = new Set<TransportErrorListener>();
  private readonly closes = new Set<TransportCloseListener>();
  private closed = false;
  private closeNotified = false;

  private readonly onSocketMessage = (event: MessageEvent) => {
    if (typeof event.data !== "string") {
      this.emitError(new Error("WebSocket transport requires text messages"));
      return;
    }
    this.emitMessage(event.data);
  };

  private readonly onSocketError = () => {
    this.emitError(new Error("WebSocket transport error"));
  };

  private readonly onSocketClose = () => {
    this.markClosed();
  };
  private readonly socket: WebSocket;

  /** Wrap an existing WebSocket; the adapter does not open it. */
  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", this.onSocketMessage);
    socket.addEventListener("error", this.onSocketError);
    socket.addEventListener("close", this.onSocketClose);
    if (socket.readyState === WebSocket.CLOSED) this.markClosed();
  }

  send(message: string): Promise<void> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket is not open"));
    }

    try {
      this.socket.send(message);
      return Promise.resolve();
    } catch (error) {
      const reason = asError(error);
      this.emitError(reason);
      return Promise.reject(reason);
    }
  }

  onMessage(listener: TransportMessageListener<string>): () => void {
    this.messages.add(listener);
    return () => removeListener(this.messages, listener);
  }

  onError(listener: TransportErrorListener): () => void {
    this.errors.add(listener);
    return () => removeListener(this.errors, listener);
  }

  onClose(listener: TransportCloseListener): () => void {
    if (this.closeNotified) {
      listener();
      return () => undefined;
    }
    this.closes.add(listener);
    return () => removeListener(this.closes, listener);
  }

  async close(): Promise<void> {
    if (this.closeNotified) return;
    this.closed = true;
    this.socket.removeEventListener("message", this.onSocketMessage);
    this.socket.removeEventListener("error", this.onSocketError);
    this.socket.removeEventListener("close", this.onSocketClose);
    if (this.socket.readyState !== WebSocket.CLOSED) this.socket.close();
    this.markClosed();
  }

  private emitMessage(message: string): void {
    if (this.closed) return;
    for (const listener of new Set(this.messages)) {
      try {
        listener(message);
      } catch (error) {
        this.emitError(error);
      }
    }
  }

  private emitError(error: unknown): void {
    const reason = asError(error);
    for (const listener of new Set(this.errors)) {
      try {
        listener(reason);
      } catch {
        // Transport observers must not break delivery to other observers.
      }
    }
  }

  private markClosed(): void {
    if (this.closeNotified) return;
    this.closed = true;
    this.closeNotified = true;
    for (const listener of new Set(this.closes)) {
      try {
        listener();
      } catch (error) {
        this.emitError(error);
      }
    }
  }
}
