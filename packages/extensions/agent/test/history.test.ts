import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactAgentHistory } from "../src/history";

describe("agent history", () => {
  it("keeps rendered chat items without raw message metadata", () => {
    assert.deepEqual(
      compactAgentHistory([
        { role: "user", content: "Inspect this file", timestamp: "ignored" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Reading" },
            {
              type: "toolCall",
              id: "call-1",
              name: "read",
              arguments: { path: "README.md" },
            },
          ],
          usage: { input: 1000000 },
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text", text: "contents" }],
        },
      ]),
      [
        { id: "history-0", role: "user", text: "Inspect this file" },
        {
          kind: "thinking",
          id: "history-thinking-1-0",
          text: "Reading",
          status: "done",
        },
        {
          kind: "tool",
          id: "history-tool-call-1",
          name: "read",
          arguments: '{\n  "path": "README.md"\n}',
          output: "contents",
          status: "done",
        },
      ],
    );
  });
});
