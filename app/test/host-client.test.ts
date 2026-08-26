import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoreEvent } from "@aria/protocol";
import {
  CORE_EVENT_METHOD,
  HOST_METHODS,
  HOST_NOTIFICATIONS,
  JSON_RPC_VERSION,
  PROTOCOL_VERSION,
} from "@aria/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { HostClient } from "../src/main/host-client";

type FixtureMode = "correlation" | "malformed" | "exit";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const temporaryDirectories: string[] = [];

async function fixture(mode: FixtureMode): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aria-host-client-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "host.ts");
  const source = [
    'import { createInterface } from "node:readline";',
    `const mode = ${JSON.stringify(mode)};`,
    `const methods = ${JSON.stringify(HOST_METHODS)};`,
    `const notifications = ${JSON.stringify(HOST_NOTIFICATIONS)};`,
    'function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }',
    'createInterface({ input: process.stdin }).on("line", (line) => {',
    "  const request = JSON.parse(line);",
    '  if (request.method === "initialize") {',
    `    send({ jsonrpc: ${JSON.stringify(JSON_RPC_VERSION)}, id: request.id, result: { protocolVersion: ${PROTOCOL_VERSION}, jsonRpcVersion: ${JSON.stringify(JSON_RPC_VERSION)}, methods, notifications, discovery: { candidates: [], registered: [], issues: [] }, extensions: [] } });`,
    "    return;",
    "  }",
    '  if (request.method === "core.request") {',
    '    if (request.params.capability === "event") {',
    `      send({ jsonrpc: ${JSON.stringify(JSON_RPC_VERSION)}, method: ${JSON.stringify(CORE_EVENT_METHOD)}, params: { type: "extension_event", event: { type: "session_event", source: "agent", payload: { type: "session_event", sessionId: "s", event: { type: "status" } } } } });`,
    "    }",
    '    if (mode === "malformed") { process.stdout.write("not-json\\n"); return; }',
    '    if (mode === "exit") { process.exit(17); return; }',
    '    const result = request.params.capability === "slow" ? "slow" : request.params.capability;',
    '    if (request.params.capability === "slow") { setTimeout(() => send({ jsonrpc: "2.0", id: request.id, result }), 20); return; }',
    '    send({ jsonrpc: "2.0", id: request.id, result });',
    "    return;",
    "  }",
    '  if (request.method === "host.shutdown") {',
    '    send({ jsonrpc: "2.0", id: request.id, result: null });',
    "    setTimeout(() => process.exit(0), 0);",
    "  }",
    "});",
  ].join("\n");
  await writeFile(path, source, "utf8");
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("HostClient", () => {
  it("correlates concurrent capability requests and forwards Core events", async () => {
    const sourcePath = await fixture("correlation");
    const events: CoreEvent[] = [];
    const client = new HostClient({
      hostSourcePath: sourcePath,
      hostRuntime: "bun",
      hostCwd: repositoryRoot,
      onEvent: (event) => events.push(event),
    });

    try {
      await client.start();
      const slow = client.request<string>("slow");
      const fast = client.request<string>("fast");

      await expect(fast).resolves.toBe("fast");
      await expect(slow).resolves.toBe("slow");
      expect(client.status).toBe("ready");

      await client.request("event");
      expect(events).toEqual([
        {
          type: "extension_event",
          event: {
            type: "session_event",
            source: "agent",
            payload: {
              type: "session_event",
              sessionId: "s",
              event: { type: "status" },
            },
          },
        },
      ]);
    } finally {
      await client.stop();
    }
  });

  it.each(["malformed", "exit"] as const)(
    "rejects pending requests when the Core host %s",
    async (mode) => {
      const sourcePath = await fixture(mode);
      const client = new HostClient({
        hostSourcePath: sourcePath,
        hostRuntime: "bun",
        hostCwd: repositoryRoot,
        shutdownTimeoutMs: 100,
      });

      try {
        await client.start();
        await expect(client.request("echo")).rejects.toThrow(
          mode === "malformed" ? "Malformed" : "Core host exited",
        );
      } finally {
        await client.stop();
      }
    },
  );
});
