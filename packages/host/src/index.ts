import { createInterface } from "node:readline";
import { type BackendService, createBackendService } from "@aria/core";
import {
  type AgentCommand,
  type AgentFeedbackResponse,
  type AgentManagerEvent,
  type AgentThinkingLevel,
  createAgentEventNotification,
  createJsonRpcError,
  createJsonRpcResult,
  HOST_METHODS,
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  type JsonRpcCall,
  type JsonRpcOutboundMessage,
  type JsonRpcParams,
  type JsonRpcRequest,
  PROTOCOL_VERSION,
  parseJsonRpcLine,
  serializeJsonRpcLine,
} from "@aria/protocol";

class RpcDispatchError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcDispatchError";
    this.code = code;
  }
}

function invalidParams(message: string): never {
  throw new RpcDispatchError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.hasOwn(value, key);
}

function hasRequestId(call: JsonRpcCall): call is JsonRpcRequest {
  return hasOwn(call, "id");
}

function objectParams(
  params: JsonRpcParams | undefined,
  method: string,
): Record<string, unknown> {
  if (!isObject(params)) {
    invalidParams(`${method} params must be an object`);
  }
  return params;
}

function noParams(params: JsonRpcParams | undefined, method: string): void {
  if (params === undefined) return;
  if (Array.isArray(params)) {
    if (params.length) invalidParams(`${method} does not accept params`);
    return;
  }
  if (!isObject(params) || Object.keys(params).length) {
    invalidParams(`${method} does not accept params`);
  }
}

function requiredString(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || !value.trim()) {
    invalidParams(`${name} must be a non-empty string`);
  }
  return value;
}

function validateInitialize(params: JsonRpcParams | undefined): void {
  const input = params === undefined ? {} : objectParams(params, "initialize");
  if (
    input.protocolVersion !== undefined &&
    input.protocolVersion !== PROTOCOL_VERSION &&
    input.protocolVersion !== String(PROTOCOL_VERSION)
  ) {
    invalidParams(
      `Unsupported protocol version: ${String(input.protocolVersion)}`,
    );
  }
}

function validatePrompt(params: JsonRpcParams | undefined) {
  const input = objectParams(params, "agent.prompt");
  const sessionId = requiredString(input, "sessionId");
  const message = requiredString(input, "message");
  const streamingBehavior = input.streamingBehavior;
  if (
    streamingBehavior !== undefined &&
    streamingBehavior !== "steer" &&
    streamingBehavior !== "followUp"
  ) {
    invalidParams("streamingBehavior is invalid");
  }

  return {
    sessionId,
    message,
    ...(streamingBehavior === undefined ? {} : { streamingBehavior }),
  };
}

function validateCommand(value: unknown): AgentCommand {
  if (!isObject(value) || typeof value.type !== "string") {
    invalidParams("command must be an object with a valid type");
  }

  switch (value.type) {
    case "get_state":
    case "get_messages":
    case "get_available_models":
    case "get_available_thinking_levels":
      return { type: value.type };
    case "set_model":
      return {
        type: value.type,
        provider: requiredString(value, "provider"),
        modelId: requiredString(value, "modelId"),
      };
    case "set_thinking_level": {
      const levels: AgentThinkingLevel[] = [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ];
      if (
        typeof value.level !== "string" ||
        !levels.includes(value.level as AgentThinkingLevel)
      ) {
        invalidParams("level is invalid");
      }
      return {
        type: value.type,
        level: value.level as AgentThinkingLevel,
      };
    }
    default:
      invalidParams("Unsupported agent command");
  }
}

function validateFeedbackResponse(value: unknown): AgentFeedbackResponse {
  if (!isObject(value) || value.type !== "extension_ui_response") {
    invalidParams("response must be an extension UI response");
  }
  const id = requiredString(value, "id");
  const hasValue = typeof value.value === "string";
  const hasConfirmation = typeof value.confirmed === "boolean";
  const cancelled = value.cancelled === true;

  if (Number(hasValue) + Number(hasConfirmation) + Number(cancelled) !== 1) {
    invalidParams("response has an invalid shape");
  }
  if (hasValue) return { type: value.type, id, value: value.value as string };
  if (hasConfirmation) {
    return {
      type: value.type,
      id,
      confirmed: value.confirmed as boolean,
    };
  }
  return { type: value.type, id, cancelled: true };
}

function validateSessionId(
  params: JsonRpcParams | undefined,
  method: string,
): string {
  return requiredString(objectParams(params, method), "sessionId");
}

function validateWorkspacePath(
  params: JsonRpcParams | undefined,
  method: string,
): { cwd: string; path: string } {
  const input = objectParams(params, method);
  return {
    cwd: requiredString(input, "cwd"),
    path: requiredString(input, "path"),
  };
}

function validateWorkspaceDirectory(params: JsonRpcParams | undefined) {
  const input = objectParams(params, "workspace.readDirectory");
  const path = input.path;
  if (path !== undefined && typeof path !== "string") {
    invalidParams("path must be a string");
  }
  return {
    cwd: requiredString(input, "cwd"),
    ...(path === undefined ? {} : { path }),
  };
}

function validateGitCommit(params: JsonRpcParams | undefined) {
  const input = objectParams(params, "workspace.gitCommit");
  return {
    cwd: requiredString(input, "cwd"),
    message: requiredString(input, "message"),
  };
}

async function dispatch(
  request: JsonRpcCall,
  backend: BackendService,
  setShutdown: () => void,
): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      validateInitialize(request.params);
      return {
        protocolVersion: PROTOCOL_VERSION,
        jsonRpcVersion: JSON_RPC_VERSION,
        methods: [...HOST_METHODS],
        notifications: ["agent.event"],
      };
    case "host.ping":
      noParams(request.params, request.method);
      return "pong";
    case "host.shutdown":
      noParams(request.params, request.method);
      setShutdown();
      backend.stopAll();
      return null;
    case "agent.list":
      noParams(request.params, request.method);
      return backend.listSessions();
    case "agent.create":
      return backend.createSession(
        requiredString(objectParams(request.params, "agent.create"), "cwd"),
      );
    case "agent.open":
      return backend.openSession(
        validateSessionId(request.params, request.method),
      );
    case "agent.prompt":
      await backend.prompt(validatePrompt(request.params));
      return null;
    case "agent.abort":
      backend.abort(validateSessionId(request.params, request.method));
      return null;
    case "agent.command": {
      const input = objectParams(request.params, request.method);
      const sessionId = requiredString(input, "sessionId");
      const command = validateCommand(input.command);
      await backend.command({ sessionId, command });
      return null;
    }
    case "agent.respond": {
      const input = objectParams(request.params, request.method);
      const sessionId = requiredString(input, "sessionId");
      const response = validateFeedbackResponse(input.response);
      backend.respond({ sessionId, response });
      return null;
    }
    case "workspace.readDirectory":
      return backend.readWorkspaceDirectory(
        validateWorkspaceDirectory(request.params),
      );
    case "workspace.gitStatus":
      return backend.getGitStatus(
        requiredString(objectParams(request.params, request.method), "cwd"),
      );
    case "workspace.gitStage":
      await backend.gitStage(
        validateWorkspacePath(request.params, request.method),
      );
      return null;
    case "workspace.gitUnstage":
      await backend.gitUnstage(
        validateWorkspacePath(request.params, request.method),
      );
      return null;
    case "workspace.gitCommit":
      await backend.gitCommit(validateGitCommit(request.params));
      return null;
    default:
      throw new RpcDispatchError(
        JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        `Method not found: ${request.method}`,
      );
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 500) : "Backend operation failed";
}

function reportDiagnostic(error: unknown): void {
  const message = errorMessage(error);
  try {
    process.stderr.write(`[aria-host] ${message}\n`);
  } catch {
    // Diagnostics must never interfere with the JSON-RPC output stream.
  }
}

let stdoutTail = Promise.resolve();

function writeMessage(message: JsonRpcOutboundMessage): Promise<void> {
  let line: string;
  try {
    line = serializeJsonRpcLine(message);
  } catch (error) {
    return Promise.reject(error);
  }

  const write = stdoutTail.then(
    () =>
      new Promise<void>((resolve, reject) => {
        process.stdout.write(line, "utf8", (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  );
  stdoutTail = write.catch((error) => {
    reportDiagnostic(error);
  });
  return write;
}

async function flushOutput(): Promise<void> {
  await stdoutTail;
}

const input = createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
});
let closeInput: (() => void) | undefined;
let shutdownRequested = false;

const backend = createBackendService({
  onEvent: (event: AgentManagerEvent) => {
    void writeMessage(createAgentEventNotification(event)).catch(
      reportDiagnostic,
    );
  },
});

closeInput = () => input.close();

async function handleLine(line: string): Promise<void> {
  let request: JsonRpcCall;
  try {
    request = parseJsonRpcLine(line);
  } catch (error) {
    if (error instanceof Error && "code" in error && "id" in error) {
      const protocolError = error as Error & {
        code: number;
        id: JsonRpcRequest["id"];
      };
      await writeMessage(
        createJsonRpcError(
          protocolError.id,
          protocolError.code,
          protocolError.message,
        ),
      );
      return;
    }
    await writeMessage(
      createJsonRpcError(
        null,
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        "Invalid JSON-RPC request",
      ),
    );
    return;
  }

  const wantsResponse = hasRequestId(request);
  const requestId = hasRequestId(request) ? request.id : null;
  if (shutdownRequested) {
    if (wantsResponse) {
      await writeMessage(
        createJsonRpcError(
          requestId,
          JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          "Host is shutting down",
        ),
      );
    }
    return;
  }

  try {
    const result = await dispatch(request, backend, () => {
      shutdownRequested = true;
    });
    if (wantsResponse) {
      await writeMessage(createJsonRpcResult(requestId, result));
    }
    if (request.method === "host.shutdown") {
      await flushOutput();
      closeInput?.();
    }
  } catch (error) {
    const code =
      error instanceof RpcDispatchError
        ? error.code
        : JSON_RPC_ERROR_CODES.INTERNAL_ERROR;
    if (wantsResponse) {
      await writeMessage(
        createJsonRpcError(requestId, code, errorMessage(error)),
      );
    } else {
      reportDiagnostic(error);
    }
  }
}

const inputClosed = new Promise<void>((resolve) => {
  input.once("close", resolve);
});

let requestTail = Promise.resolve();
input.on("line", (line) => {
  const task = requestTail.then(() => handleLine(line));
  requestTail = task.catch(reportDiagnostic);
});

await inputClosed;
await requestTail;
if (!shutdownRequested) backend.stopAll();
await flushOutput();
