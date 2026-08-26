import { describe, expect, it } from "vitest";
import { parseChatBlocks } from "../src/renderer/components/panels/chat-markdown";

describe("chat markdown", () => {
  it("separates fenced code and Mermaid blocks from chat text", () => {
    expect(
      parseChatBlocks(
        "Before\n\n```ts\nconst answer = 42;\n```\n\n```mermaid\ngraph TD\n  A --> B\n```",
      ),
    ).toEqual([
      { kind: "text", text: "Before\n" },
      { kind: "code", language: "ts", code: "const answer = 42;" },
      { kind: "mermaid", code: "graph TD\n  A --> B" },
    ]);
  });
});
