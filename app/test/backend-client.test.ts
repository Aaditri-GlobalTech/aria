import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_METHODS } from "@aria/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { BackendClient } from "../src/main/backend-client";

type FixtureMode = "correlation" | "malformed" | "exit";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temporaryDirectories: string[] = [];

async function fixture(mode: FixtureMode): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aria-backend-client-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "host.ts");
  const source = [
    'import { createInterface } from "node:readline";',
    `const mode = ${JSON.stringify(mode)};`,
    `const methods = ${JSON.stringify(HOST_METHODS)};`,
    'function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }',
    'createInterface({ input: process.stdin }).on("line", (line) => {',
    "  const request = JSON.parse(line);",
    '  if (request.method === "initialize") {',
    '    send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1, jsonRpcVersion: "2.0", methods, notifications: ["agent.event"] } });',
    "    return;",
    "  }",
    '  if (request.method === "agent.create") {',
    '    send({ jsonrpc: "2.0", method: "agent.event", params: { type: "session_event", sessionId: "s", event: { type: "status" } } });',
    "  }",
    '  if (request.method === "host.shutdown") {',
    '    send({ jsonrpc: "2.0", id: request.id, result: null });',
    "    setTimeout(() => process.exit(0), 0);",
    "    return;",
    "  }",
    '  if (mode === "malformed") { process.stdout.write("not-json\\n"); return; }',
    '  if (mode === "exit") { process.exit(17); return; }',
    '  if (mode === "correlation" && request.method === "host.ping") {',
    '    setTimeout(() => send({ jsonrpc: "2.0", id: request.id, result: "pong" }), 20);',
    "    return;",
    "  }",
    '  if (mode === "correlation") {',
    '    send({ jsonrpc: "2.0", id: request.id, result: request.method });',
    "    return;",
    "  }",
    '  send({ jsonrpc: "2.0", id: request.id, result: null });',
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

describe("BackendClient", () => {
  it("correlates concurrent responses and forwards agent events", async () => {
    const sourcePath = await fixture("correlation");
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const client = new BackendClient({
      hostSourcePath: sourcePath,
      hostRuntime: "bun",
      hostCwd: repositoryRoot,
      onEvent: (event) => events.push(event),
    });

    try {
      await client.start();
      const slow = client.request<string>("host.ping");
      const fast = client.request<string>("agent.list");

      await expect(fast).resolves.toBe("agent.list");
      await expect(slow).resolves.toBe("pong");
      expect(client.status).toBe("ready");

      await client.request("agent.create");
      expect(events).toEqual([
        {
          type: "session_event",
          sessionId: "s",
          event: { type: "status" },
        },
      ]);
    } finally {
      await client.stop();
    }
  });

  it.each(["malformed", "exit"] as const)(
    "rejects pending requests when the host %s",
    async (mode) => {
      const sourcePath = await fixture(mode);
      const client = new BackendClient({
        hostSourcePath: sourcePath,
        hostRuntime: "bun",
        hostCwd: repositoryRoot,
        shutdownTimeoutMs: 100,
      });

      try {
        await client.start();
        await expect(client.request("host.ping")).rejects.toThrow(
          mode === "malformed" ? "Malformed" : "Backend exited",
        );
      } finally {
        await client.stop();
      }
    },
  );
});
