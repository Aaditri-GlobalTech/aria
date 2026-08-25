import {
  type HostInitializeResult,
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  type JsonRpcCall,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcOutboundMessage,
  type JsonRpcParams,
  type JsonRpcRequest,
  type JsonRpcResponse,
  PROTOCOL_VERSION,
} from "./messages";

export class JsonRpcProtocolError extends Error {
  readonly code: number;
  readonly id: JsonRpcId;

  constructor(code: number, message: string, id: JsonRpcId = null) {
    super(message);
    this.name = "JsonRpcProtocolError";
    this.code = code;
    this.id = id;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function isJsonRpcParams(value: unknown): value is JsonRpcParams {
  return Array.isArray(value) || isRecord(value);
}

function requestId(value: Record<string, unknown>): JsonRpcId {
  return hasOwn(value, "id") && isJsonRpcId(value.id) ? value.id : null;
}

/** Validate a parsed JSON-RPC request or notification at the wire boundary. */
export function validateJsonRpcMessage(value: unknown): JsonRpcCall {
  if (!isRecord(value)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid JSON-RPC request",
    );
  }

  const id = requestId(value);
  if (value.jsonrpc !== JSON_RPC_VERSION) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid JSON-RPC version",
      id,
    );
  }
  if (typeof value.method !== "string" || !value.method) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC method is required",
      id,
    );
  }
  if (hasOwn(value, "params") && !isJsonRpcParams(value.params)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC params must be an object or array",
      id,
    );
  }
  if (hasOwn(value, "id") && !isJsonRpcId(value.id)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC request id is invalid",
    );
  }

  return hasOwn(value, "id")
    ? (value as unknown as JsonRpcRequest)
    : (value as unknown as JsonRpcNotification);
}

/** Parse one complete newline-delimited JSON-RPC frame. */
export function parseJsonRpcLine(line: string): JsonRpcCall {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.PARSE_ERROR,
      "Parse error",
    );
  }

  return validateJsonRpcMessage(value);
}

/** Validate a JSON-RPC response received from the host. */
export function validateJsonRpcResponse(value: unknown): JsonRpcResponse {
  if (!isRecord(value)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid JSON-RPC response",
    );
  }

  const id = hasOwn(value, "id") && isJsonRpcId(value.id) ? value.id : null;
  if (value.jsonrpc !== JSON_RPC_VERSION) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid JSON-RPC version",
      id,
    );
  }
  if (!hasOwn(value, "id") || !isJsonRpcId(value.id)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC response id is invalid",
      id,
    );
  }

  const hasResult = hasOwn(value, "result");
  const hasError = hasOwn(value, "error");
  if (hasResult === hasError) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC response must contain exactly one result or error",
      value.id,
    );
  }
  if (hasError && !isJsonRpcError(value.error)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC error is invalid",
      value.id,
    );
  }

  return value as unknown as JsonRpcResponse;
}

/** Validate a JSON-RPC notification received from the host. */
export function validateJsonRpcNotification(
  value: unknown,
): JsonRpcNotification {
  if (isRecord(value) && hasOwn(value, "id")) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC notification must not have an id",
    );
  }
  return validateJsonRpcMessage(value) as JsonRpcNotification;
}

/** Validate either kind of message the host may write to stdout. */
export function validateJsonRpcOutboundMessage(
  value: unknown,
): JsonRpcOutboundMessage {
  if (isRecord(value) && hasOwn(value, "method")) {
    return validateJsonRpcNotification(value);
  }
  return validateJsonRpcResponse(value);
}

/** Parse one complete host response or notification frame. */
export function parseJsonRpcOutboundLine(line: string): JsonRpcOutboundMessage {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.PARSE_ERROR,
      "Parse error",
    );
  }

  return validateJsonRpcOutboundMessage(value);
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return (
    isRecord(value) &&
    typeof value.code === "number" &&
    Number.isFinite(value.code) &&
    typeof value.message === "string"
  );
}

/** Validate the result returned by the host initialization handshake. */
export function validateHostInitializeResult(
  value: unknown,
): HostInitializeResult {
  if (
    !isRecord(value) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.jsonRpcVersion !== JSON_RPC_VERSION ||
    !Array.isArray(value.methods) ||
    !value.methods.every((method) => typeof method === "string") ||
    !Array.isArray(value.notifications) ||
    !value.notifications.every((method) => typeof method === "string")
  ) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid host initialization response",
    );
  }

  return value as unknown as HostInitializeResult;
}
