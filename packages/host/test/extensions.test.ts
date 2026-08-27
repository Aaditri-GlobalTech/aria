import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import {
  validateHostInitializeResult,
  validateRuntimeEventNotification,
} from "@aria/protocol";
import { ExtensionHost, StdioTransport } from "../src";
import { MessageCollector } from "./message-collector";

describe("built-in extensions", () => {
  it("serves Agent and Workspace capabilities through ExtensionHost", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-extension-host-"));
    const repositoryRoot = resolve(import.meta.dir, "../..");
    const sources = [
      resolve(repositoryRoot, "extensions", "agent"),
      resolve(repositoryRoot, "extensions", "workspace"),
    ];
    const previousSessionDirectory = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = join(directory, "sessions");
    const input = new PassThrough();
    const output = new PassThrough();
    const collector = new MessageCollector(output);
    const host = new ExtensionHost({
      extensionSources: sources,
      transport: new StdioTransport({ input, output }),
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
      if (!("result" in initialize)) return;
      const initializeResult = validateHostInitializeResult(initialize.result);
      assert.deepEqual(
        initializeResult.extensions.map((extension) => extension.id),
        ["agent", "workspace"],
      );

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "capability.request",
          params: {
            capability: "workspace.readDirectory",
            payload: { cwd: directory, path: "" },
          },
        })}\n`,
      );
      const workspace = await collector.response(2);
      assert.deepEqual(
        "result" in workspace ? workspace.result : undefined,
        [],
      );

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "capability.request",
          params: { capability: "agent.list", payload: null },
        })}\n`,
      );
      const agents = await collector.response(3);
      assert.deepEqual("result" in agents ? agents.result : undefined, []);

      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "capability.request",
          params: {
            capability: "agent.create",
            payload: { cwd: directory },
          },
        })}\n`,
      );
      const created = await collector.response(4);
      assert.ok("result" in created);
      assert.ok(
        collector.messages.some((message) => {
          if (!("method" in message) || message.method !== "runtime.event") {
            return false;
          }
          try {
            const event = validateRuntimeEventNotification(message).params;
            return (
              event.type === "extension_event" &&
              event.event.source === "agent" &&
              event.event.type === "agent.manager"
            );
          } catch {
            return false;
          }
        }),
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
    } finally {
      await host.stop();
      collector.close();
      input.end();
      output.destroy();
      if (previousSessionDirectory === undefined) {
        delete process.env.PI_CODING_AGENT_SESSION_DIR;
      } else {
        process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionDirectory;
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
