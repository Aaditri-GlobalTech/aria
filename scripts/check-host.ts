import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  HOST_METHODS,
  HOST_NOTIFICATIONS,
  JSON_RPC_VERSION,
  type JsonRpcOutboundMessage,
  type JsonRpcParams,
  PROTOCOL_VERSION,
  parseJsonRpcOutboundLine,
  serializeJsonRpcLine,
  validateHostInitializeResult,
} from "../packages/protocol/src";

type PendingResponse = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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
  "host",
  `aria-host${process.platform === "win32" ? ".exe" : ""}`,
);
const extensionSources = [
  resolve(repositoryRoot, "app", "resources", "extensions", "agent.cjs"),
  resolve(repositoryRoot, "app", "resources", "extensions", "workspace.cjs"),
];
await Promise.all([
  access(executablePath),
  ...extensionSources.map((source) => access(source)),
]);
const checkDirectory = await mkdtemp(join(tmpdir(), "aria-host-check-"));
const sessionDirectory = join(checkDirectory, "sessions");

const child = spawn(
  executablePath,
  extensionSources.flatMap((source) => ["--extension-source", source]),
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PI_CODING_AGENT_SESSION_DIR: sessionDirectory,
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);
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
  if (failure) return;
  failure = asError(error);
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(failure);
  }
  pending.clear();
}

lines.on("line", (line) => {
  let message: JsonRpcOutboundMessage;
  try {
    message = parseJsonRpcOutboundLine(line);
  } catch (error) {
    fail(error);
    return;
  }

  if ("method" in message) return;
  if (typeof message.id !== "number" || !Number.isSafeInteger(message.id)) {
    fail(new Error(`Unexpected host response id: ${String(message.id)}`));
    return;
  }

  const request = pending.get(message.id);
  if (!request) {
    fail(new Error(`Unexpected host response id: ${message.id}`));
    return;
  }
  pending.delete(message.id);
  clearTimeout(request.timer);
  if ("error" in message) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
child.stderr.resume();
child.once("error", fail);

const exit = new Promise<ExitResult>((resolveExit) => {
  child.once("exit", (code, signal) => resolveExit({ code, signal }));
});

function request(method: string, params?: JsonRpcParams): Promise<unknown> {
  if (failure) return Promise.reject(failure);
  const id = nextId++;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Timed out waiting for ${method}`));
      child.kill();
    }, 5000);
    pending.set(id, {
      resolve: resolveRequest,
      reject: rejectRequest,
      timer,
    });
    child.stdin.write(
      serializeJsonRpcLine({
        jsonrpc: JSON_RPC_VERSION,
        id,
        method,
        ...(params === undefined ? {} : { params }),
      }),
      (error) => {
        if (error) fail(error);
      },
    );
  });
}

try {
  const initialize = validateHostInitializeResult(
    await request("initialize", { protocolVersion: PROTOCOL_VERSION }),
  );
  assert.deepEqual(initialize.methods, HOST_METHODS);
  assert.deepEqual(initialize.notifications, HOST_NOTIFICATIONS);
  assert.deepEqual(
    initialize.extensions.map((extension) => extension.id).sort(),
    ["agent", "workspace"],
  );
  assert.equal(await request("host.ping"), "pong");
  assert.deepEqual(
    await request("core.request", {
      capability: "workspace.readDirectory",
      payload: { cwd: checkDirectory, path: "" },
    }),
    [],
  );
  assert.deepEqual(
    await request("core.request", {
      capability: "agent.list",
      payload: null,
    }),
    [],
  );
  assert.equal(await request("host.shutdown"), null);

  const result = await Promise.race([
    exit,
    new Promise<ExitResult>((_, reject) =>
      setTimeout(
        () => reject(new Error("Timed out waiting for host exit")),
        5000,
      ),
    ),
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  console.log(`Host smoke passed: ${executablePath}`);
} finally {
  lines.close();
  if (child.exitCode === null) child.kill();
  await rm(checkDirectory, { recursive: true, force: true });
}
