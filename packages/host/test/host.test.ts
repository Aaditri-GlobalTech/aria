import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HOST_METHODS,
  type JsonRpcErrorResponse,
  type JsonRpcSuccessResponse,
  PROTOCOL_VERSION,
} from "@aria/protocol";

type JsonObject = Record<string, unknown>;
type JsonRpcResponse = JsonRpcErrorResponse | JsonRpcSuccessResponse;

type Waiter = {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class HostClient {
  readonly child: ChildProcessWithoutNullStreams;
  readonly notifications: JsonObject[] = [];
  readonly exit: Promise<number | null>;
  private readonly waiters = new Map<string, Waiter>();
  private nextId = 1;
  private failure: Error | undefined;

  constructor() {
    const hostDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    this.child = spawn(process.execPath, ["run", "src/index.ts"], {
      cwd: hostDirectory,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const lines = createInterface({
      input: this.child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    lines.on("line", (line) => this.handleLine(line));
    this.child.once("error", (error) => this.fail(error));
    this.child.stderr.resume();
    this.exit = new Promise((resolveExit) => {
      this.child.once("exit", (code) => resolveExit(code));
    });
  }

  send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId;
    this.nextId += 1;
    const response = new Promise<JsonRpcResponse>((resolveResponse, reject) => {
      this.waiters.set(String(id), {
        resolve: resolveResponse,
        reject,
      });
    });
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    this.child.stdin.write(`${JSON.stringify(request)}\n`);
    return Promise.race([
      response,
      new Promise<JsonRpcResponse>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Timed out waiting for ${method}`)),
          5000,
        );
      }),
    ]);
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.fail(new Error(`Malformed host output: ${line}`));
      return;
    }
    if (!isObject(message) || message.jsonrpc !== "2.0") {
      this.fail(new Error(`Unexpected host output: ${line}`));
      return;
    }

    if (typeof message.method === "string" && !Object.hasOwn(message, "id")) {
      this.notifications.push(message);
      return;
    }
    if (!Object.hasOwn(message, "id")) {
      this.fail(new Error(`Unexpected host output: ${line}`));
      return;
    }
    const waiter = this.waiters.get(String(message.id));
    if (!waiter) {
      this.fail(new Error(`Unexpected response id: ${String(message.id)}`));
      return;
    }
    this.waiters.delete(String(message.id));
    if (!Object.hasOwn(message, "result") && !Object.hasOwn(message, "error")) {
      this.fail(new Error(`Malformed host response: ${line}`));
      return;
    }
    waiter.resolve(message as JsonRpcResponse);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiters.values()) waiter.reject(error);
    this.waiters.clear();
  }
}

describe("Bun host JSON-RPC pipe", () => {
  it("handles handshake, backend calls, errors, ping, and shutdown", async () => {
    const cwd = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "aria-host-"));
    const client = new HostClient();

    try {
      const initialize = await client.send("initialize", {
        protocolVersion: PROTOCOL_VERSION,
      });
      assert.ok("result" in initialize);
      const initializeResult = initialize.result as {
        methods: string[];
        protocolVersion: number;
      };
      assert.equal(initializeResult.protocolVersion, PROTOCOL_VERSION);
      assert.deepEqual(initializeResult.methods, HOST_METHODS);

      const ping = await client.send("host.ping");
      assert.ok("result" in ping);
      assert.equal(ping.result, "pong");

      const directory = await client.send("workspace.readDirectory", {
        cwd,
        path: "",
      });
      assert.ok("result" in directory);
      assert.deepEqual(directory.result, []);

      const created = await client.send("agent.create", { cwd });
      assert.ok("result" in created);
      assert.equal((created.result as { cwd: string }).cwd, cwd);
      assert.equal(client.notifications[0]?.method, "agent.event");
      assert.ok(
        client.notifications.every((event) => event.method === "agent.event"),
      );

      const unknown = await client.send("workspace.pick");
      assert.ok("error" in unknown);
      assert.equal(unknown.error.code, -32601);

      const invalid = await client.send("agent.create", { cwd: 42 });
      assert.ok("error" in invalid);
      assert.equal(invalid.error.code, -32602);

      const shutdown = await client.send("host.shutdown");
      assert.ok("result" in shutdown);
      assert.equal(shutdown.result, null);
      assert.equal(await client.exit, 0);
      assert.equal(client.notifications.length, 2);
      assert.ok(
        client.notifications.every((event) => event.method === "agent.event"),
      );
    } finally {
      if (client.child.exitCode === null) client.child.kill();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
