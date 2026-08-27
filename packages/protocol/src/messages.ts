import type {
  DiscoveryReport,
  ExtensionSnapshot,
  JsonArray,
  JsonObject,
  JsonValue,
  RuntimeEvent,
} from "@aria/core";

/** JSON-RPC version used by every host message. */
export const JSON_RPC_VERSION = "2.0" as const;

/** Version of Aria's host protocol contract. */
export const PROTOCOL_VERSION = 1 as const;

/** Notification method used for generic runtime events. */
export const RUNTIME_EVENT_METHOD = "runtime.event" as const;

/** Standard JSON-RPC error codes emitted by the host. */
export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** JSON-RPC request/response correlation value. */
export type JsonRpcId = string | number | null;

/** Object or array accepted as JSON-RPC params. */
export type JsonRpcParams = JsonObject | JsonArray;

/** A JSON-RPC request that expects a response. */
export type JsonRpcRequest = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: JsonRpcParams;
};

/** A JSON-RPC notification that has no response ID. */
export type JsonRpcNotification = {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: unknown;
};

/** Either kind of inbound JSON-RPC call. */
export type JsonRpcCall = JsonRpcRequest | JsonRpcNotification;

/** Error object carried by a JSON-RPC error response. */
export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

/** Successful JSON-RPC response. */
export type JsonRpcSuccessResponse = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  result: unknown;
};

/** Failed JSON-RPC response. */
export type JsonRpcErrorResponse = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  error: JsonRpcError;
};

/** Either successful or failed JSON-RPC response. */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** Message the host may write: a response or runtime notification. */
export type JsonRpcOutboundMessage = JsonRpcResponse | JsonRpcNotification;

/** Any message accepted by the protocol encoder. */
export type JsonRpcWireMessage = JsonRpcCall | JsonRpcResponse;

/** Host calls always use request IDs and therefore expect a response. */
export type HostRequest = JsonRpcRequest;

/** Optional parameters for the host initialization request. */
export type HostInitializeParams = {
  protocolVersion?: number;
};

/** Parameters for a feature-agnostic capability request. */
export type CapabilityRequestParams = {
  capability: string;
  payload: JsonValue;
};

/** Parameters for starting or stopping one extension. */
export type ExtensionRequestParams = {
  extensionId: string;
};

/** Capabilities advertised by the host during initialization. */
export type HostInitializeResult = {
  protocolVersion: typeof PROTOCOL_VERSION;
  jsonRpcVersion: typeof JSON_RPC_VERSION;
  methods: readonly string[];
  notifications: readonly string[];
  discovery: DiscoveryReport;
  extensions: readonly ExtensionSnapshot[];
};

/** JSON-RPC methods implemented by `ExtensionHost`. */
export const HOST_METHODS = [
  "initialize",
  "host.ping",
  "host.shutdown",
  "extension.list",
  "capability.request",
  "extension.start",
  "extension.stop",
] as const;

/** Union of methods advertised in {@link HOST_METHODS}. */
export type HostMethod = (typeof HOST_METHODS)[number];

/** JSON-RPC notifications implemented by `ExtensionHost`. */
export const HOST_NOTIFICATIONS = [RUNTIME_EVENT_METHOD] as const;

/** Wire form of a runtime event notification. */
export type RuntimeEventNotification = {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof RUNTIME_EVENT_METHOD;
  params: RuntimeEvent;
};

/** Build a successful JSON-RPC response for a request ID. */
export function createJsonRpcResult(
  id: JsonRpcId,
  result: unknown,
): JsonRpcSuccessResponse {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

/** Build a JSON-RPC error response, optionally with diagnostic data. */
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

/** Build a JSON-RPC notification without a response ID. */
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

/** Encode one JSON-RPC message without transport-specific framing. */
export function serializeJsonRpcMessage(message: JsonRpcWireMessage): string {
  const encoded = JSON.stringify(message);
  if (encoded === undefined) {
    throw new Error("JSON-RPC message is not serializable");
  }
  return encoded;
}

/** Encode one outbound JSON-RPC message as one newline-delimited frame. */
export function serializeJsonRpcLine(message: JsonRpcWireMessage): string {
  return `${serializeJsonRpcMessage(message)}\n`;
}
