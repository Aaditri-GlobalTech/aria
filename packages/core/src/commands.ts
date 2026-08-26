import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DiscoveryIssue } from "./discovery";
import { JsonValueSchema } from "./schemas";
import type { JsonValue } from "./types";

export type DiscoveryReport = {
  candidates: readonly string[];
  registered: readonly string[];
  issues: readonly DiscoveryIssue[];
};

export type RuntimeCommandMap = {
  initialize: { type: "initialize" };
  start: { type: "start"; extensionId: string };
  request: { type: "request"; capability: string; payload: JsonValue };
  stop: { type: "stop"; extensionId: string };
  shutdown: { type: "shutdown" };
};

export type RuntimeCommand = RuntimeCommandMap[keyof RuntimeCommandMap];
export type RuntimeCommandType = keyof RuntimeCommandMap;

export type RuntimeCommandResultMap = {
  initialize: DiscoveryReport;
  start: undefined;
  request: JsonValue;
  stop: undefined;
  shutdown: undefined;
};

export type RuntimeCommandResult<
  K extends RuntimeCommandType = RuntimeCommandType,
> = RuntimeCommandResultMap[K];

export const RuntimeCommandSchema = Type.Union([
  Type.Object({ type: Type.Literal("initialize") }),
  Type.Object({ type: Type.Literal("start"), extensionId: Type.String() }),
  Type.Object({
    type: Type.Literal("request"),
    capability: Type.String(),
    payload: JsonValueSchema,
  }),
  Type.Object({ type: Type.Literal("stop"), extensionId: Type.String() }),
  Type.Object({ type: Type.Literal("shutdown") }),
]);

export function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  return Value.Check(RuntimeCommandSchema, value);
}
