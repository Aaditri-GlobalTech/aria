import type { AgentManagerEvent, AgentSession } from "./agent";
import {
  JSON_RPC_ERROR_CODES,
  JSON_RPC_VERSION,
  type JsonRpcNotification,
} from "./messages";
import {
  JsonRpcProtocolError,
  validateJsonRpcNotification,
} from "./validation";

export const AGENT_EVENT_METHOD = "agent.event" as const;

export type AgentEventNotification = {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: typeof AGENT_EVENT_METHOD;
  params: AgentManagerEvent;
};

export function createAgentEventNotification(
  event: AgentManagerEvent,
): AgentEventNotification {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method: AGENT_EVENT_METHOD,
    params: event,
  } satisfies JsonRpcNotification;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentSession(value: unknown): value is AgentSession {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.cwd === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    typeof value.active === "boolean" &&
    typeof value.unread === "boolean"
  );
}

function isAgentManagerEvent(value: unknown): value is AgentManagerEvent {
  if (!isObject(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "sessions":
      return (
        Array.isArray(value.sessions) && value.sessions.every(isAgentSession)
      );
    case "session_update":
      return isAgentSession(value.session);
    case "session_event":
      return (
        typeof value.sessionId === "string" &&
        isObject(value.event) &&
        typeof value.event.type === "string"
      );
    case "feedback_request":
      return typeof value.sessionId === "string" && isObject(value.request);
    default:
      return false;
  }
}

/** Validate the host's renderer-facing agent event notification. */
export function validateAgentEventNotification(
  value: unknown,
): AgentEventNotification {
  const notification = validateJsonRpcNotification(value);
  if (
    notification.method !== AGENT_EVENT_METHOD ||
    !isAgentManagerEvent(notification.params)
  ) {
    throw new JsonRpcProtocolError(
      JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      "Invalid agent event notification",
    );
  }
  return notification as AgentEventNotification;
}
