import { Database } from "bun:sqlite";
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
  JSON_RPC_ERROR_CODES,
  RUNTIME_EVENT_METHOD,
  validateHostInitializeResult,
} from "@aria/protocol";
import { ExtensionHost } from "../src";
import { MessageCollector } from "./message-collector";

describe("ExtensionHost", () => {
  it("hosts the extension runtime behind a generic request and event protocol", async () => {
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

    const ariaDirectory = join(directory, "aria");
    const input = new PassThrough();
    const output = new PassThrough();
    const collector = new MessageCollector(output);
    const host = new ExtensionHost({
      ariaDirectory,
      extensionSources: [source],
      input,
      output,
    });

    try {
      await host.start();
      assert.equal(
        (await stat(join(ariaDirectory, "extensions"))).isDirectory(),
        true,
      );
      assert.equal((await stat(join(ariaDirectory, "host.db"))).isFile(), true);
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
      assert.ok(initializeResult.methods.includes("capability.request"));
      assert.ok(!initializeResult.methods.includes("agent.list"));

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "capability.request",
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
            "method" in message && message.method === RUNTIME_EVENT_METHOD,
        ),
      );

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "extension.start",
          params: { extensionId: "echo" },
        })}\n`,
      );
      await collector.response(3);

      let database = new Database(join(ariaDirectory, "host.db"), {
        readonly: true,
      });
      const activeLeases = database
        .query<{ extension_id: string; acquired: number }, []>(
          "SELECT extension_id, acquired FROM manual_leases",
        )
        .all();
      database.close();
      assert.deepEqual(activeLeases, [{ extension_id: "echo", acquired: 1 }]);

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "capability.request",
          params: { capability: "example.echo" },
        })}\n`,
      );
      const invalid = await collector.response(4);
      assert.equal(
        "error" in invalid ? invalid.error.code : undefined,
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      );

      input.write("not valid json\n");
      const parseError = await collector.next();
      assert.equal(
        "error" in parseError ? parseError.error.code : undefined,
        JSON_RPC_ERROR_CODES.PARSE_ERROR,
      );

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "host.shutdown",
        })}\n`,
      );
      await collector.response(5);
      assert.equal(host.state, "stopped");
      await host.stop();

      database = new Database(join(ariaDirectory, "host.db"), {
        readonly: true,
      });
      const clearedLeases = database
        .query<{ extension_id: string; acquired: number }, []>(
          "SELECT extension_id, acquired FROM manual_leases",
        )
        .all();
      database.close();
      assert.deepEqual(clearedLeases, [{ extension_id: "echo", acquired: 0 }]);
    } finally {
      await host.stop();
      collector.close();
      input.end();
      output.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers active manual leases from Host storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-host-recovery-"));
    const source = join(directory, "recoverable.mjs");
    await writeFile(
      source,
      `export default {
        id: "recoverable",
        execution: "main",
        create() {
          return { start() {}, stop() {} };
        },
      };`,
      "utf8",
    );

    const ariaDirectory = join(directory, "aria");
    const input = new PassThrough();
    const output = new PassThrough();
    const collector = new MessageCollector(output);
    const host = new ExtensionHost({
      ariaDirectory,
      extensionSources: [source],
      input,
      output,
    });

    try {
      await host.start();
      const database = new Database(join(ariaDirectory, "host.db"));
      database.run(
        "INSERT INTO manual_leases (extension_id, acquired) VALUES (?, ?)",
        ["recoverable", 1],
      );
      database.close();

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        })}\n`,
      );
      await collector.response(1);
      assert.equal(host.runtime.getExtension("recoverable")?.state, "running");
    } finally {
      await host.stop();
      collector.close();
      input.end();
      output.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates global extension storage without loading it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-host-dir-"));
    const ariaDirectory = join(directory, "aria");
    const host = new ExtensionHost({
      ariaDirectory,
      input: new PassThrough(),
      output: new PassThrough(),
    });

    try {
      await host.start();
      await host.runtime.dispatch({ type: "initialize" });
      assert.deepEqual(host.runtime.getExtensions(), []);
      assert.equal(
        (await stat(join(ariaDirectory, "extensions"))).isDirectory(),
        true,
      );
    } finally {
      await host.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
