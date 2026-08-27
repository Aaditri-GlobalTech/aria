import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type {
  JsonRpcError,
  JsonRpcParams,
  JsonRpcRequest,
} from "@aria/protocol";
import {
  JSON_RPC_VERSION,
  PROTOCOL_VERSION,
  parseJsonRpcOutboundLine,
  RUNTIME_EVENT_METHOD,
  serializeJsonRpcLine,
  validateHostInitializeResult,
  validateRuntimeEventNotification,
} from "@aria/protocol";

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rpcError(error: JsonRpcError): Error {
  return new Error(`${error.message} (${error.code})`);
}

const hostSource = resolve(import.meta.dir, "../src/main.ts");
const host = spawn(
  process.execPath,
  ["run", hostSource, "--stdio", ...process.argv.slice(2)],
  { stdio: ["pipe", "pipe", "inherit"] },
);
const lines = createInterface({
  input: host.stdout,
  crlfDelay: Number.POSITIVE_INFINITY,
});
const pending = new Map<number, PendingRequest>();
const exit = new Promise<void>((resolveExit) => {
  host.once("exit", () => resolveExit());
});
let nextId = 1;

function rejectPending(error: unknown): void {
  const reason = error instanceof Error ? error : new Error(String(error));
  for (const request of pending.values()) request.reject(reason);
  pending.clear();
}

function fail(error: unknown): void {
  rejectPending(error);
  if (host.exitCode === null) host.kill();
}

host.once("error", fail);
host.once("exit", (code, signal) => {
  if (pending.size > 0) {
    fail(
      new Error(
        `Host exited before completing requests${
          code === null ? ` (${signal ?? "unknown signal"})` : ` (${code})`
        }`,
      ),
    );
  }
});

lines.on("line", (line) => {
  let message: ReturnType<typeof parseJsonRpcOutboundLine>;
  try {
    message = parseJsonRpcOutboundLine(line);
  } catch (error) {
    fail(new Error(`Malformed Host output: ${errorMessage(error)}`));
    return;
  }

  if ("method" in message) {
    if (message.method !== RUNTIME_EVENT_METHOD) {
      fail(new Error(`Unexpected Host notification: ${message.method}`));
      return;
    }
    try {
      const event = validateRuntimeEventNotification(message);
      console.error(`[runtime.event] ${event.params.type}`);
    } catch (error) {
      fail(new Error(`Malformed runtime event: ${errorMessage(error)}`));
    }
    return;
  }

  if (typeof message.id !== "number" || !Number.isSafeInteger(message.id)) {
    fail(new Error("Host returned an invalid response id"));
    return;
  }
  const request = pending.get(message.id);
  if (!request) {
    fail(new Error(`Unexpected Host response id: ${message.id}`));
    return;
  }
  pending.delete(message.id);
  if ("error" in message) request.reject(rpcError(message.error));
  else request.resolve(message.result);
});

function request(method: string, params?: JsonRpcParams): Promise<unknown> {
  const id = nextId;
  nextId += 1;
  const message: JsonRpcRequest = {
    jsonrpc: JSON_RPC_VERSION,
    id,
    method,
    ...(params === undefined ? {} : { params }),
  };
  return new Promise<unknown>((resolveRequest, rejectRequest) => {
    pending.set(id, {
      resolve: resolveRequest,
      reject: rejectRequest,
    });
    try {
      host.stdin.write(serializeJsonRpcLine(message), "utf8", (error) => {
        if (!error) return;
        pending.delete(id);
        rejectRequest(error);
      });
    } catch (error) {
      pending.delete(id);
      rejectRequest(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function main(): Promise<void> {
  try {
    const initialize = validateHostInitializeResult(
      await request("initialize", { protocolVersion: PROTOCOL_VERSION }),
    );
    console.log(`Host protocol: ${initialize.protocolVersion}`);
    console.log(
      `Extensions: ${initialize.extensions.map(({ id }) => id).join(", ") || "none"}`,
    );
    console.log(`Ping: ${await request("host.ping")}`);
    await request("extension.list");
    await request("host.shutdown");
    host.stdin.end();
    await exit;
  } finally {
    lines.close();
    if (host.exitCode === null) {
      host.stdin.end();
      host.kill();
      await exit;
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`[client] ${errorMessage(error)}`);
  process.exitCode = 1;
}
