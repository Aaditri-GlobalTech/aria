import type { AgentToolCall } from "@aria/extension-agent";
import { describe, expect, it } from "vitest";
import { readToolRange } from "../src/renderer/components/panels/AgentView";

function tool(argumentsText: string): AgentToolCall {
  return {
    kind: "tool",
    id: "read-1",
    name: "read",
    arguments: argumentsText,
    output: "file contents",
    status: "done",
  };
}

describe("tool display", () => {
  it("formats the read offset and limit as a line range", () => {
    expect(
      readToolRange(tool('{"path":"file.ts","offset":1,"limit":100}')),
    ).toBe("1-100");
    expect(readToolRange(tool('{"path":"file.ts","offset":25}'))).toBe("25");
  });
});
