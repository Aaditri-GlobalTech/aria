import type { CoreEvent } from "@aria/core";
import {
  CORE_EVENT_METHOD,
  type CoreEventNotification,
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
} from "./messages";
import {
  JsonRpcProtocolError,
  validateJsonRpcNotification,
} from "./validation";

export function createCoreEventNotification(
  event: CoreEvent,
): CoreEventNotification {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method: CORE_EVENT_METHOD,
    params: event,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the generic Core event envelope without knowing feature payloads. */
export function validateCoreEventNotification(
  value: unknown,
): CoreEventNotification {
  const notification = validateJsonRpcNotification(value);
  if (
    notification.method !== CORE_EVENT_METHOD ||
    !isRecord(notification.params) ||
    typeof notification.params.type !== "string"
  ) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid Core event notification",
    );
  }
  return notification as CoreEventNotification;
}
