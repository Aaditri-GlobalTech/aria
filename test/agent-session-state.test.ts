import { describe, expect, it } from "vitest";
import {
  applySessionEvent,
  createSessionClientState,
} from "../src/renderer/components/panels/agent-session-state";

function event(value: Record<string, unknown>) {
  return value as { type: string; [key: string]: unknown };
}

describe("session event stream", () => {
  it("keeps a tool call correlated and streams its output", () => {
    let state = createSessionClientState();
    state = applySessionEvent(
      state,
      event({ type: "message_start", message: { role: "assistant" } }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_start",
          contentIndex: 0,
        },
      }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_delta",
          contentIndex: 0,
          delta: "Inspecting the workspace",
        },
      }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_end",
          contentIndex: 0,
          content: "Inspecting the workspace",
        },
      }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 1,
          partial: { name: "bash" },
        },
      }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_delta",
          contentIndex: 1,
          delta: '{"command":"ls"}',
        },
      }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 1,
          toolCall: {
            id: "call-1",
            name: "bash",
            arguments: { command: "ls" },
          },
        },
      }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "bash",
        args: { command: "ls" },
      }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "tool_execution_update",
        toolCallId: "call-1",
        partialResult: {
          content: [{ type: "text", text: "partial" }],
        },
      }),
    );
    state = applySessionEvent(
      state,
      event({
        type: "tool_execution_end",
        toolCallId: "call-1",
        result: { content: [{ type: "text", text: "done" }] },
        isError: false,
      }),
    );

    expect(state.messages).toContainEqual({
      kind: "thinking",
      id: "thinking-assistant-1-1",
      text: "Inspecting the workspace",
      status: "done",
    });
    expect(state.messages).toContainEqual({
      kind: "tool",
      id: "tool-assistant-1-1",
      name: "bash",
      arguments: '{\n  "command": "ls"\n}',
      output: "done",
      status: "done",
    });
  });
});
