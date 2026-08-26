import type { ExtensionEvent, JsonValue, LogLevel } from "./types";

export const CORE_PROTOCOL_VERSION = 1;

export type WireCommand = "start" | "stop" | "shutdown";

export type WireMessage =
  | {
      type: "hello";
      protocolVersion: typeof CORE_PROTOCOL_VERSION;
      extensionId: string;
    }
  | { type: "command"; id: string; command: WireCommand }
  | {
      type: "invoke";
      id: string;
      capability: string;
      payload: JsonValue;
    }
  | {
      type: "request";
      id: string;
      capability: string;
      payload: JsonValue;
    }
  | {
      type: "response";
      id: string;
      success: true;
      value?: JsonValue;
    }
  | { type: "response"; id: string; success: false; error: string }
  | { type: "event"; event: ExtensionEvent }
  | { type: "subscribe"; eventType: string }
  | { type: "unsubscribe"; eventType: string }
  | { type: "capability_register"; name: string }
  | { type: "capability_unregister"; name: string }
  | {
      type: "log";
      level: LogLevel;
      message: string;
      details?: JsonValue;
    };

const wireTypes = new Set([
  "hello",
  "command",
  "invoke",
  "request",
  "response",
  "event",
  "subscribe",
  "unsubscribe",
  "capability_register",
  "capability_unregister",
  "log",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isWireMessage(value: unknown): value is WireMessage {
  return (
    isObject(value) &&
    typeof value.type === "string" &&
    wireTypes.has(value.type)
  );
}
