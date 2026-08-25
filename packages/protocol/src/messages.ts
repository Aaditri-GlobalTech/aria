export const JSON_RPC_VERSION = "2.0" as const;
export const PROTOCOL_VERSION = 1 as const;

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcId = string | number | null;
export type JsonRpcParams = Record<string, unknown> | unknown[];

export type JsonRpcRequest = {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: JsonRpcParams;
};

export type JsonRpcNotification = {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: JsonRpcParams;
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
export type JsonRpcWireMessage = JsonRpcRequest | JsonRpcOutboundMessage;

export type HostInitializeResult = {
  protocolVersion: typeof PROTOCOL_VERSION;
  jsonRpcVersion: typeof JSON_RPC_VERSION;
  methods: string[];
  notifications: string[];
};

/** Methods accepted by the Bun host. Electron-only operations are omitted. */
export const HOST_METHODS = [
  "initialize",
  "host.ping",
  "host.shutdown",
  "agent.list",
  "agent.create",
  "agent.open",
  "agent.prompt",
  "agent.abort",
  "agent.command",
  "agent.respond",
  "workspace.readDirectory",
  "workspace.gitStatus",
  "workspace.gitStage",
  "workspace.gitUnstage",
  "workspace.gitCommit",
] as const;

export type HostMethod = (typeof HOST_METHODS)[number];

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
  params?: JsonRpcParams,
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
  if (encoded === undefined)
    throw new Error("JSON-RPC message is not serializable");
  return `${encoded}\n`;
}
