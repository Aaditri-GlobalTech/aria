import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  connectLocalSocket,
  LocalSocketTransport,
  StdioTransport,
  WebSocketTransport,
} from "../src";

class FakeWebSocket {
  readyState = 1;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close", {});
  }

  receive(message: string): void {
    this.emit("message", { data: message });
  }

  fail(): void {
    this.emit("error", {});
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("host transports", () => {
  it("frames stdio messages as newline-delimited text", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = new StdioTransport({ input, output });
    const received = new Promise<string>((resolve) => {
      transport.onMessage(resolve);
    });

    input.write("inbound");
    input.write(" message\n");
    assert.equal(await received, "inbound message");

    const sent = new Promise<string>((resolve) => {
      output.once("data", (chunk: Buffer) => resolve(chunk.toString()));
    });
    await transport.send("outbound");
    assert.equal(await sent, "outbound\n");

    await transport.close();
    input.destroy();
    output.destroy();
  });

  it("connects through a local socket with newline framing", async () => {
    const socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\aria-test-${process.pid}-${randomUUID()}`
        : join(tmpdir(), `aria-test-${process.pid}-${randomUUID()}`);
    const server = createServer((socket) => {
      const transport = new LocalSocketTransport(socket);
      transport.onMessage((message) => {
        void transport.send(message).catch(() => undefined);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const transport = await connectLocalSocket(socketPath);
      const received = new Promise<string>((resolve) => {
        transport.onMessage(resolve);
      });
      await transport.send("inbound");
      assert.equal(await received, "inbound");
      await transport.close();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      if (process.platform !== "win32") {
        await rm(socketPath, { force: true });
      }
    }
  });

  it("sends and receives text messages over WebSocket", async () => {
    const socket = new FakeWebSocket();
    const transport = new WebSocketTransport(socket as unknown as WebSocket);
    const received = new Promise<string>((resolve) => {
      transport.onMessage(resolve);
    });

    socket.receive("inbound");
    assert.equal(await received, "inbound");
    await transport.send("outbound");
    assert.deepEqual(socket.sent, ["outbound"]);

    await transport.close();
    assert.equal(socket.closed, true);
  });
});
