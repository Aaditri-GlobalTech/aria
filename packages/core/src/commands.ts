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

export type CoreCommandMap = {
  initialize: { type: "initialize" };
  start: { type: "start"; extensionId: string };
  request: { type: "request"; capability: string; payload: JsonValue };
  stop: { type: "stop"; extensionId: string };
  shutdown: { type: "shutdown" };
};

export type CoreCommand = CoreCommandMap[keyof CoreCommandMap];
export type CoreCommandType = keyof CoreCommandMap;

export type CoreCommandResultMap = {
  initialize: DiscoveryReport;
  start: undefined;
  request: JsonValue;
  stop: undefined;
  shutdown: undefined;
};

export type CoreCommandResult<K extends CoreCommandType = CoreCommandType> =
  CoreCommandResultMap[K];

export const CoreCommandSchema = Type.Union([
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

export function isCoreCommand(value: unknown): value is CoreCommand {
  return Value.Check(CoreCommandSchema, value);
}
