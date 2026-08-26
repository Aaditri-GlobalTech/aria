import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { createCore } from "@aria/core";
import {
  CORE_EVENT_METHOD,
  JSON_RPC_ERROR_CODES,
  type JsonRpcOutboundMessage,
  parseJsonRpcOutboundLine,
  validateHostInitializeResult,
} from "@aria/protocol";
import { createHost } from "../src";

class MessageCollector {
  readonly messages: JsonRpcOutboundMessage[] = [];
  private readonly waiters: Array<(message: JsonRpcOutboundMessage) => void> =
    [];
  private readonly lines;

  constructor(input: PassThrough) {
    this.lines = createInterface({
      input,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    this.lines.on("line", (line) => {
      const message = parseJsonRpcOutboundLine(line);
      this.messages.push(message);
      this.waiters.shift()?.(message);
    });
  }

  next(): Promise<JsonRpcOutboundMessage> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async response(id: number) {
    while (true) {
      const message = await this.next();
      if ("id" in message && message.id === id) return message;
    }
  }

  close() {
    this.lines.close();
  }
}

describe("CoreHost", () => {
  it("hosts Core behind a generic request and event protocol", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-host-"));
    const source = join(directory, "echo.mjs");
    await writeFile(
      source,
      `export default {
        id: "echo",
        execution: "main",
        capabilities: ["example.echo"],
        create(context) {
          return {
            start() {
              context.provide("example.echo", (payload) => ({ received: payload }));
            },
            stop() {},
          };
        },
      };`,
      "utf8",
    );

    const input = new PassThrough();
    const output = new PassThrough();
    const collector = new MessageCollector(output);
    const host = createHost({
      core: createCore({ extensionSources: [source] }),
      input,
      output,
    });

    try {
      await host.start();
      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1 },
        })}\n`,
      );
      const initialize = await collector.response(1);
      assert.ok("result" in initialize);
      const initializeResult = validateHostInitializeResult(initialize.result);
      assert.deepEqual(initializeResult.extensions[0], {
        id: "echo",
        source,
        execution: "main",
        dependencies: [],
        capabilities: ["example.echo"],
        state: "ready",
        consumers: 0,
      });
      assert.ok(initializeResult.methods.includes("core.request"));
      assert.ok(!initializeResult.methods.includes("agent.list"));

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "core.request",
          params: {
            capability: "example.echo",
            payload: { value: 7 },
          },
        })}\n`,
      );
      const request = await collector.response(2);
      assert.deepEqual("result" in request ? request.result : undefined, {
        received: { value: 7 },
      });
      assert.ok(
        collector.messages.some(
          (message) =>
            "method" in message && message.method === CORE_EVENT_METHOD,
        ),
      );

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "core.request",
          params: { capability: "example.echo" },
        })}\n`,
      );
      const invalid = await collector.response(3);
      assert.equal(
        "error" in invalid ? invalid.error.code : undefined,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      );

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "host.shutdown",
        })}\n`,
      );
      await collector.response(4);
      assert.equal(host.state, "stopped");
    } finally {
      await host.stop();
      collector.close();
      input.end();
      output.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
