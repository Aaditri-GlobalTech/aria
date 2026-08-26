import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createJsonRpcResult,
  HOST_METHODS,
  HOST_NOTIFICATIONS,
  JSON_RPC_VERSION,
  type JsonRpcTransport,
  PROTOCOL_VERSION,
  parseJsonRpcLine,
  serializeJsonRpcMessage,
} from "@aria/protocol";
import { HostClient } from "../../examples/node";

class LoopbackTransport implements JsonRpcTransport {
  closed = false;
  private readonly messages = new Set<(message: string) => void>();
  private readonly errors = new Set<(error: Error) => void>();
  private readonly closes = new Set<() => void>();

  send(message: string): Promise<void> {
    const request = parseJsonRpcLine(message);
    if (!("id" in request)) return Promise.resolve();
    if (
      request.method === "capability.request" &&
      request.params &&
      !Array.isArray(request.params) &&
      request.params.capability === "slow"
    ) {
      return Promise.resolve();
    }

    const result =
      request.method === "initialize"
        ? {
            protocolVersion: PROTOCOL_VERSION,
            jsonRpcVersion: JSON_RPC_VERSION,
            methods: [...HOST_METHODS],
            notifications: [...HOST_NOTIFICATIONS],
            discovery: { candidates: [], registered: [], issues: [] },
            extensions: [],
          }
        : request.method === "host.ping"
          ? "pong"
          : null;
    const response = serializeJsonRpcMessage(
      createJsonRpcResult(request.id, result),
    );
    queueMicrotask(() => {
      for (const listener of this.messages) listener(response);
    });
    return Promise.resolve();
  }

  onMessage(listener: (message: string) => void): () => void {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errors.add(listener);
    return () => this.errors.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closes.add(listener);
    return () => this.closes.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closes) listener();
  }
}

describe("HostClient", () => {
  it("uses an injected transport and preserves the host handshake", async () => {
    const transport = new LoopbackTransport();
    const client = new HostClient({ transport });

    await client.start();
    assert.equal(await client.ping(), "pong");
    assert.equal(client.status, "ready");

    await client.stop();
    assert.equal(client.status, "stopped");
    assert.equal(transport.closed, true);
  });

  it("times out a request that never receives a response", async () => {
    const transport = new LoopbackTransport();
    const client = new HostClient({
      transport,
      requestTimeoutMs: 10,
    });

    try {
      await client.start();
      await assert.rejects(
        client.request("slow"),
        /Extension host request timed out: capability\.request/,
      );
    } finally {
      await client.stop();
    }
  });
});
