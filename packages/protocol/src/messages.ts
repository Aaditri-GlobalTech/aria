import type {
  DiscoveryReport,
  ExtensionSnapshot,
  JsonArray,
  JsonObject,
  JsonValue,
  RuntimeEvent,
} from "@aria/core";

export const JSON_RPC_VERSION = "2.0" as const;
export const PROTOCOL_VERSION = 1 as const;
export const RUNTIME_EVENT_METHOD = "runtime.event" as const;

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcId = string | number | null;
export type JsonRpcParams = JsonObject | JsonArray;

export type JsonRpcRequest = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: JsonRpcParams;
};

export type JsonRpcNotification = {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: unknown;
};

export type JsonRpcCall = JsonRpcRequest | JsonRpcNotification;

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcSuccessResponse = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcErrorResponse = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  error: JsonRpcError;
};

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcOutboundMessage = JsonRpcResponse | JsonRpcNotification;
export type JsonRpcWireMessage = JsonRpcCall | JsonRpcResponse;
export type HostRequest = JsonRpcRequest;

export type HostInitializeParams = {
  protocolVersion?: number;
};

export type CapabilityRequestParams = {
  capability: string;
  payload: JsonValue;
};

export type ExtensionRequestParams = {
  extensionId: string;
};

export type HostInitializeResult = {
  protocolVersion: typeof PROTOCOL_VERSION;
  jsonRpcVersion: typeof JSON_RPC_VERSION;
  methods: readonly string[];
  notifications: readonly string[];
  discovery: DiscoveryReport;
  extensions: readonly ExtensionSnapshot[];
};

export const HOST_METHODS = [
  "initialize",
  "host.ping",
  "host.shutdown",
  "extension.list",
  "capability.request",
  "extension.start",
  "extension.stop",
] as const;

export type HostMethod = (typeof HOST_METHODS)[number];

export const HOST_NOTIFICATIONS = [RUNTIME_EVENT_METHOD] as const;

export type RuntimeEventNotification = {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof RUNTIME_EVENT_METHOD;
  params: RuntimeEvent;
};

export function createJsonRpcResult(
  id: JsonRpcId,
  result: unknown,
): JsonRpcSuccessResponse {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

export function createJsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

export function createJsonRpcNotification(
  method: string,
  params?: unknown,
): JsonRpcNotification {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method,
    ...(params === undefined ? {} : { params }),
  };
}

/** Encode one outbound JSON-RPC message as one newline-delimited frame. */
export function serializeJsonRpcLine(message: JsonRpcWireMessage): string {
  const encoded = JSON.stringify(message);
  if (encoded === undefined) {
    throw new Error("JSON-RPC message is not serializable");
  }
  return `${encoded}\n`;
}
