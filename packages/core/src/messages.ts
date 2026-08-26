import { Type } from "typebox";
import { Value } from "typebox/value";
import { JsonValueSchema } from "./schemas";
import type { ExtensionEvent, JsonValue, LogLevel } from "./types";

export const EXTENSION_TRANSPORT_VERSION = 1;

export type WireCommand = "start" | "stop" | "shutdown";

export type WireMessage =
  | {
      type: "hello";
      protocolVersion: typeof EXTENSION_TRANSPORT_VERSION;
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

const ExtensionEventSchema = Type.Object({
  type: Type.String(),
  source: Type.String(),
  payload: Type.Optional(JsonValueSchema),
});

export const WireMessageSchema = Type.Union([
  Type.Object({
    type: Type.Literal("hello"),
    protocolVersion: Type.Literal(EXTENSION_TRANSPORT_VERSION),
    extensionId: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("command"),
    id: Type.String(),
    command: Type.Union([
      Type.Literal("start"),
      Type.Literal("stop"),
      Type.Literal("shutdown"),
    ]),
  }),
  Type.Object({
    type: Type.Literal("invoke"),
    id: Type.String(),
    capability: Type.String(),
    payload: JsonValueSchema,
  }),
  Type.Object({
    type: Type.Literal("request"),
    id: Type.String(),
    capability: Type.String(),
    payload: JsonValueSchema,
  }),
  Type.Object({
    type: Type.Literal("response"),
    id: Type.String(),
    success: Type.Literal(true),
    value: Type.Optional(JsonValueSchema),
  }),
  Type.Object({
    type: Type.Literal("response"),
    id: Type.String(),
    success: Type.Literal(false),
    error: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("event"),
    event: ExtensionEventSchema,
  }),
  Type.Object({ type: Type.Literal("subscribe"), eventType: Type.String() }),
  Type.Object({ type: Type.Literal("unsubscribe"), eventType: Type.String() }),
  Type.Object({
    type: Type.Literal("capability_register"),
    name: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("capability_unregister"),
    name: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("log"),
    level: Type.Union([
      Type.Literal("debug"),
      Type.Literal("info"),
      Type.Literal("warn"),
      Type.Literal("error"),
    ]),
    message: Type.String(),
    details: Type.Optional(JsonValueSchema),
  }),
]);

export function isWireMessage(value: unknown): value is WireMessage {
  return Value.Check(WireMessageSchema, value);
}
