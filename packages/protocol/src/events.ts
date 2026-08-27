import type { RuntimeEvent } from "@aria/core";
import {
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  RUNTIME_EVENT_METHOD,
  type RuntimeEventNotification,
} from "./messages";
import {
  JsonRpcProtocolError,
  validateJsonRpcNotification,
} from "./validation";

/** Wrap a runtime event as the host's `runtime.event` notification. */
export function createRuntimeEventNotification(
  event: RuntimeEvent,
): RuntimeEventNotification {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method: RUNTIME_EVENT_METHOD,
    params: event,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the generic runtime event envelope without knowing feature payloads. */
export function validateRuntimeEventNotification(
  value: unknown,
): RuntimeEventNotification {
  const notification = validateJsonRpcNotification(value);
  if (
    notification.method !== RUNTIME_EVENT_METHOD ||
    !isRecord(notification.params) ||
    typeof notification.params.type !== "string"
  ) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid runtime event notification",
    );
  }
  return notification as RuntimeEventNotification;
}
