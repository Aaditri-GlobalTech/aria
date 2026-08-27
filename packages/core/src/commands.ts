import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DiscoveryIssue } from "./discovery";
import { JsonValueSchema } from "./schemas";
import type { JsonValue } from "./types";

/** Result of one initialization pass over the configured extension sources. */
export type DiscoveryReport = {
  /** Candidate files and package directories considered by discovery. */
  candidates: readonly string[];
  /** Extension IDs that registered successfully. */
  registered: readonly string[];
  /** Invalid candidates or definitions that were skipped. */
  issues: readonly DiscoveryIssue[];
};

/** Maps each command name to its validated command shape. */
export type RuntimeCommandMap = {
  initialize: { type: "initialize" };
  start: { type: "start"; extensionId: string };
  request: { type: "request"; capability: string; payload: JsonValue };
  stop: { type: "stop"; extensionId: string };
  shutdown: { type: "shutdown" };
};

/** Any command accepted by `ExtensionRuntime.dispatch()`. */
export type RuntimeCommand = RuntimeCommandMap[keyof RuntimeCommandMap];

/** Names of commands accepted by the runtime. */
export type RuntimeCommandType = keyof RuntimeCommandMap;

/** Maps each command name to the value returned by dispatch. */
export type RuntimeCommandResultMap = {
  initialize: DiscoveryReport;
  start: undefined;
  request: JsonValue;
  stop: undefined;
  shutdown: undefined;
};

/** Result type corresponding to a command name. */
export type RuntimeCommandResult<
  K extends RuntimeCommandType = RuntimeCommandType,
> = RuntimeCommandResultMap[K];

/** TypeBox schema used to validate untrusted runtime commands. */
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

/** Return whether an unknown value has a valid runtime command shape. */
export function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  return Value.Check(RuntimeCommandSchema, value);
}
