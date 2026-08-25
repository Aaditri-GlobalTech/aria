import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  HOST_METHODS,
  PROTOCOL_VERSION,
} from "../packages/protocol/src/index.ts";

type JsonObject = Record<string, unknown>;
type PendingResponse = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};
type ExitResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = resolve(
  repositoryRoot,
  "app",
  "resources",
  "backend",
  `aria-backend${process.platform === "win32" ? ".exe" : ""}`,
);
await access(executablePath);

const child = spawn(executablePath, [], {
  cwd: repositoryRoot,
  env: { ...process.env },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({
  input: child.stdout,
  crlfDelay: Number.POSITIVE_INFINITY,
});
const pending = new Map<number, PendingResponse>();
let nextId = 1;
let failure: Error | undefined;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function fail(error: unknown): void {
  const reason = asError(error);
  if (failure) return;
  failure = reason;
  for (const request of pending.values()) request.reject(reason);
  pending.clear();
}

lines.on("line", (line) => {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    fail(new Error(`Malformed sidecar output: ${line}`));
    return;
  }

  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message) ||
    (message as JsonObject).jsonrpc !== "2.0" ||
    typeof (message as JsonObject).id !== "number"
  ) {
    fail(new Error(`Unexpected sidecar output: ${line}`));
    return;
  }

  const response = message as JsonObject;
  const id = response.id as number;
  const request = pending.get(id);
  if (!request) {
    fail(new Error(`Unexpected sidecar response id: ${id}`));
    return;
  }
  pending.delete(id);
  if (Object.hasOwn(response, "error")) {
    const error = response.error as JsonObject;
    request.reject(
      new Error(String(error.message ?? "Sidecar request failed")),
    );
  } else if (Object.hasOwn(response, "result")) {
    request.resolve(response.result);
  } else {
    request.reject(new Error(`Malformed sidecar response: ${line}`));
  }
});
child.stderr.resume();
child.once("error", fail);

const exit = new Promise<ExitResult>((resolveExit) => {
  child.once("exit", (code, signal) => resolveExit({ code, signal }));
});

function request(method: string, params?: JsonObject): Promise<unknown> {
  if (failure) return Promise.reject(failure);
  const id = nextId++;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Timed out waiting for ${method}`));
      child.kill();
    }, 5000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolveRequest(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        rejectRequest(error);
      },
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      })}\n`,
      (error) => {
        if (error) fail(error);
      },
    );
  });
}

try {
  const initialize = (await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
  })) as JsonObject;
  assert.equal(initialize.protocolVersion, PROTOCOL_VERSION);
  assert.equal(initialize.jsonRpcVersion, "2.0");
  assert.deepEqual(initialize.methods, HOST_METHODS);

  assert.equal(await request("host.ping"), "pong");
  assert.equal(await request("host.shutdown"), null);

  const result = await Promise.race([
    exit,
    new Promise<ExitResult>((_, reject) =>
      setTimeout(
        () => reject(new Error("Timed out waiting for sidecar exit")),
        5000,
      ),
    ),
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  console.log(`Sidecar smoke passed: ${executablePath}`);
} finally {
  lines.close();
  if (child.exitCode === null) child.kill();
}
