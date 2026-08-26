import { Type } from "typebox";

/** JSON-safe values used by runtime commands and isolated extension messages. */
export const JsonValueSchema = Type.Cyclic(
  {
    JsonValue: Type.Union([
      Type.Null(),
      Type.String(),
      Type.Number(),
      Type.Boolean(),
      Type.Array(Type.Ref("JsonValue")),
      Type.Record(Type.String(), Type.Ref("JsonValue")),
    ]),
  },
  "JsonValue",
);
