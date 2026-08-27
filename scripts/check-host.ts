import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectLocalSocket } from "../packages/host/src/transports";
import {
  HOST_METHODS,
  HOST_NOTIFICATIONS,
  JSON_RPC_VERSION,
  type JsonRpcOutboundMessage,
  type JsonRpcParams,
  PROTOCOL_VERSION,
  parseJsonRpcOutboundLine,
  serializeJsonRpcMessage,
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
const socketPath =
  process.platform === "win32"
    ? `\\\\.\\pipe\\aria-host-check-${process.pid}-${randomUUID()}`
    : join(tmpdir(), `aria-host-check-${process.pid}-${randomUUID()}.sock`);

const child = spawn(
  executablePath,
  [
    "--socket-path",
    socketPath,
    ...extensionSources.flatMap((source) => ["--extension-source", source]),
  ],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PI_CODING_AGENT_SESSION_DIR: sessionDirectory,
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
child.stderr?.resume();

async function connectSocket() {
  const deadline = Date.now() + 5000;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      return await connectLocalSocket(socketPath);
    } catch (error) {
      lastError = asError(error);
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  throw new Error(
    `Timed out connecting to host socket: ${lastError?.message ?? socketPath}`,
  );
}

let transport: Awaited<ReturnType<typeof connectLocalSocket>> | undefined;
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

let removeMessageListener: (() => void) | undefined;

function handleMessage(line: string): void {
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
}
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
    }, 30_000);
    pending.set(id, {
      resolve: resolveRequest,
      reject: rejectRequest,
      timer,
    });
    const socket = transport;
    if (!socket) {
      fail(new Error("Host socket is unavailable"));
      return;
    }
    void socket
      .send(
        serializeJsonRpcMessage({
          jsonrpc: JSON_RPC_VERSION,
          id,
          method,
          ...(params === undefined ? {} : { params }),
        }),
      )
      .catch(fail);
  });
}

try {
  transport = await connectSocket();
  removeMessageListener = transport.onMessage(handleMessage);

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
    await request("capability.request", {
      capability: "workspace.readDirectory",
      payload: { cwd: checkDirectory, path: "" },
    }),
    [],
  );
  assert.deepEqual(
    await request("capability.request", {
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
  removeMessageListener?.();
  await transport?.close();
  if (child.exitCode === null) child.kill();
  await rm(checkDirectory, { recursive: true, force: true });
  if (process.platform !== "win32") {
    await rm(socketPath, { force: true });
  }
}
