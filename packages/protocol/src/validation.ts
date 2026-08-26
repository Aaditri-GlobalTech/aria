import type { JsonValue } from "@aria/core";
import {
  HOST_METHODS,
  type HostInitializeResult,
  type HostRequest,
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

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function isJsonRpcParams(value: unknown): value is JsonRpcParams {
  return isJsonValue(value) && (Array.isArray(value) || isRecord(value));
}

function messageId(value: Record<string, unknown>): JsonRpcId {
  return hasOwn(value, "id") && isJsonRpcId(value.id) ? value.id : null;
}

export function isJsonRpcRequest(value: JsonRpcCall): value is JsonRpcRequest {
  return "id" in value;
}

/** Validate a parsed JSON-RPC request or notification at the wire boundary. */
export function validateJsonRpcMessage(value: unknown): JsonRpcCall {
  if (!isRecord(value)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid JSON-RPC request",
    );
  }

  const id = messageId(value);
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

function invalidParams(request: JsonRpcRequest, message: string): never {
  throw new JsonRpcProtocolError(
    JSON_RPC_ERROR_CODES.INVALID_PARAMS,
    message,
    request.id,
  );
}

function paramsObject(request: JsonRpcRequest): Record<string, unknown> {
  if (!isRecord(request.params)) {
    return invalidParams(request, "Params must be an object");
  }
  return request.params;
}

function noParams(request: JsonRpcRequest): void {
  if (request.params === undefined) return;
  if (Array.isArray(request.params) && request.params.length === 0) return;
  if (isRecord(request.params) && Object.keys(request.params).length === 0) {
    return;
  }
  invalidParams(request, `${request.method} does not accept params`);
}

function requiredString(
  request: JsonRpcRequest,
  params: Record<string, unknown>,
  name: string,
): string {
  const value = params[name];
  if (typeof value !== "string" || !value.trim()) {
    return invalidParams(request, `${name} must be a non-empty string`);
  }
  return value;
}

function validateInitialize(request: JsonRpcRequest): void {
  if (request.params === undefined) return;
  const params = paramsObject(request);
  const version = params.protocolVersion;
  if (
    version !== undefined &&
    (typeof version !== "number" || version !== PROTOCOL_VERSION)
  ) {
    invalidParams(request, `Unsupported protocol version: ${String(version)}`);
  }
}

function validateCoreRequest(request: JsonRpcRequest): void {
  const params = paramsObject(request);
  requiredString(request, params, "capability");
  if (!Object.hasOwn(params, "payload") || !isJsonValue(params.payload)) {
    invalidParams(request, "payload must be a JSON value");
  }
}

/** Validate a request understood by the generic Core host. */
export function validateHostRequest(value: unknown): HostRequest {
  const message = validateJsonRpcMessage(value);
  if (!isJsonRpcRequest(message)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Host requests require an id",
    );
  }

  if (!HOST_METHODS.includes(message.method as (typeof HOST_METHODS)[number])) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
      `Method not found: ${message.method}`,
      message.id,
    );
  }

  switch (message.method) {
    case "initialize":
      validateInitialize(message);
      break;
    case "host.ping":
    case "host.shutdown":
    case "core.extensions":
      noParams(message);
      break;
    case "core.request":
      validateCoreRequest(message);
      break;
    case "core.start":
    case "core.stop":
      requiredString(message, paramsObject(message), "extensionId");
      break;
  }

  return message;
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.PARSE_ERROR,
      "Parse error",
    );
  }
}

/** Parse one complete newline-delimited JSON-RPC frame. */
export function parseJsonRpcLine(line: string): JsonRpcCall {
  return validateJsonRpcMessage(parseJsonLine(line));
}

/** Parse and validate one request sent to the Core host. */
export function parseHostRequestLine(line: string): HostRequest {
  return validateHostRequest(parseJsonLine(line));
}

/** Validate a JSON-RPC response received from the host. */
export function validateJsonRpcResponse(value: unknown): JsonRpcResponse {
  if (!isRecord(value)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid JSON-RPC response",
    );
  }

  const id = messageId(value);
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
  if (hasResult && !isJsonValue(value.result)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC result is not a JSON value",
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
  const notification = validateJsonRpcMessage(value);
  if (isJsonRpcRequest(notification)) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "JSON-RPC notification must not have an id",
      notification.id,
    );
  }
  return notification;
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
  return validateJsonRpcOutboundMessage(parseJsonLine(line));
}

function isJsonRpcError(value: unknown): value is JsonRpcError {
  if (!isRecord(value)) return false;
  if (
    typeof value.code !== "number" ||
    !Number.isFinite(value.code) ||
    typeof value.message !== "string"
  ) {
    return false;
  }
  return !hasOwn(value, "data") || isJsonValue(value.data);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isDiscoveryReport(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.candidates) &&
    isStringArray(value.registered) &&
    Array.isArray(value.issues) &&
    value.issues.every((issue) => {
      if (!isRecord(issue)) return false;
      return (
        typeof issue.source === "string" && typeof issue.error === "string"
      );
    })
  );
}

function isExtensionSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    (value.execution === "main" ||
      value.execution === "worker" ||
      value.execution === "child") &&
    isStringArray(value.dependencies) &&
    isStringArray(value.capabilities) &&
    typeof value.state === "string" &&
    typeof value.consumers === "number"
  );
}

/** Validate the generic initialization handshake returned by the host. */
export function validateHostInitializeResult(
  value: unknown,
): HostInitializeResult {
  if (
    !isRecord(value) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    value.jsonRpcVersion !== JSON_RPC_VERSION ||
    !isStringArray(value.methods) ||
    !isStringArray(value.notifications) ||
    !isDiscoveryReport(value.discovery) ||
    !Array.isArray(value.extensions) ||
    !value.extensions.every(isExtensionSnapshot)
  ) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid host initialization response",
    );
  }

  return value as unknown as HostInitializeResult;
}
