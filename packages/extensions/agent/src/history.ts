/** Reduce Pi history to the fields rendered by the desktop chat. */
import type { AgentChatItem, AgentThinkingBlock, AgentToolCall } from "./types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      const record = asObject(block);
      return record?.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .join("");
}

function toolResultText(result: unknown): string {
  const record = asObject(result);
  const diff = asObject(record?.details)?.diff;
  return typeof diff === "string" ? diff : textFromContent(record?.content);
}

function textFromMessage(message: unknown): string {
  return textFromContent(asObject(message)?.content);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function isToolCall(item: AgentChatItem): item is AgentToolCall {
  return "kind" in item && item.kind === "tool";
}

/** Convert persisted Pi messages into the smaller set of UI chat items. */
export function compactAgentHistory(messages: unknown): AgentChatItem[] {
  if (!Array.isArray(messages)) return [];

  const result: AgentChatItem[] = [];
  const toolIndexes = new Map<string, number>();

  for (const [index, message] of messages.entries()) {
    const record = asObject(message);
    const role = record?.role;
    if (role !== "user" && role !== "assistant") {
      if (role !== "toolResult" || typeof record?.toolCallId !== "string") {
        continue;
      }

      const existingIndex = toolIndexes.get(record.toolCallId);
      const output = toolResultText(record);
      const status = record.isError === true ? "error" : "done";
      if (existingIndex !== undefined && isToolCall(result[existingIndex])) {
        result[existingIndex] = {
          ...result[existingIndex],
          output,
          status,
        };
      } else {
        result.push({
          kind: "tool",
          id: `history-tool-${record.toolCallId}`,
          name: typeof record.toolName === "string" ? record.toolName : "Tool",
          arguments: "",
          output,
          status,
        });
      }
      continue;
    }

    const content = record?.content;
    if (!Array.isArray(content)) {
      const text = textFromMessage(message);
      if (text) result.push({ id: `history-${index}`, role, text });
      continue;
    }

    if (role === "user") {
      const text = textFromContent(content);
      if (text) result.push({ id: `history-${index}`, role, text });
      continue;
    }

    for (const [blockIndex, block] of content.entries()) {
      const blockRecord = asObject(block);
      if (
        blockRecord?.type === "text" &&
        typeof blockRecord.text === "string"
      ) {
        result.push({
          id: `history-${index}-text-${blockIndex}`,
          role,
          text: blockRecord.text,
        });
        continue;
      }
      if (
        blockRecord?.type === "thinking" &&
        typeof blockRecord.thinking === "string"
      ) {
        const item: AgentThinkingBlock = {
          kind: "thinking",
          id: `history-thinking-${index}-${blockIndex}`,
          text: blockRecord.thinking,
          status: "done",
        };
        result.push(item);
        continue;
      }
      if (
        blockRecord?.type !== "toolCall" ||
        typeof blockRecord.id !== "string"
      ) {
        continue;
      }

      const item: AgentToolCall = {
        kind: "tool",
        id: `history-tool-${blockRecord.id}`,
        name: typeof blockRecord.name === "string" ? blockRecord.name : "Tool",
        arguments: formatValue(blockRecord.arguments),
        output: "",
        status: "running",
      };
      toolIndexes.set(blockRecord.id, result.length);
      result.push(item);
    }
  }

  return result;
}
