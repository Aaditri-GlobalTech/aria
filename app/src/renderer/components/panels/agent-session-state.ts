/**
 * Reduce Pi's raw RPC stream into stable chat items and control selections.
 * The maps below preserve identity while message, thinking, and tool events
 * arrive in separate chunks.
 */

import type {
  AgentChatItem,
  AgentEvent,
  AgentModel,
  AgentThinkingBlock,
  AgentThinkingLevel,
  AgentToolCall,
} from "@aria/extension-agent";
import { compactAgentHistory } from "@aria/extension-agent";

/** All renderer state associated with one selected session. */
export type SessionClientState = {
  messages: AgentChatItem[];
  models: AgentModel[];
  selectedModel: string;
  thinkingLevels: AgentThinkingLevel[];
  thinkingLevel: AgentThinkingLevel;
  draft: string;
  assistantCounter: number;
  thinkingCounter: number;
  toolCounter: number;
  currentAssistantId?: string;
  currentAssistantHasText: boolean;
  thinkingIds: Map<string, string>;
  toolAliases: Map<string, string>;
};

/** Create an empty state before the first Pi history response arrives. */
export function createSessionClientState(): SessionClientState {
  return {
    messages: [],
    models: [],
    selectedModel: "",
    thinkingLevels: [],
    thinkingLevel: "medium",
    draft: "",
    assistantCounter: 0,
    thinkingCounter: 0,
    toolCounter: 0,
    currentAssistantHasText: false,
    thinkingIds: new Map(),
    toolAliases: new Map(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isToolCall(item: AgentChatItem): item is AgentToolCall {
  return "kind" in item && item.kind === "tool";
}

function isThinking(item: AgentChatItem): item is AgentThinkingBlock {
  return "kind" in item && item.kind === "thinking";
}

function isThinkingLevel(value: unknown): value is AgentThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function asModel(value: unknown): AgentModel | undefined {
  const model = asRecord(value);
  if (typeof model?.provider !== "string" || typeof model.id !== "string") {
    return undefined;
  }
  return {
    provider: model.provider,
    id: model.id,
    name: typeof model.name === "string" ? model.name : undefined,
  };
}

/** Use the same provider/id key for select values and RPC updates. */
export function modelKey(model: AgentModel) {
  return `${model.provider}/${model.id}`;
}

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      const record = asRecord(block);
      return record?.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .join("");
}

function toolResultText(result: unknown) {
  const record = asRecord(result);
  const diff = asRecord(record?.details)?.diff;
  return typeof diff === "string" ? diff : textFromContent(record?.content);
}

function textFromMessage(message: unknown) {
  return textFromContent(asRecord(message)?.content);
}

function toolName(value: unknown) {
  const record = asRecord(value);
  return typeof record?.name === "string" ? record.name : "Tool";
}

/** Apply one Pi event immutably so Solid can refresh the selected session. */
export function applySessionEvent(
  state: SessionClientState,
  event: AgentEvent,
): SessionClientState {
  // Clone maps because their contents are mutated while the outer state stays immutable.
  const next: SessionClientState = {
    ...state,
    thinkingIds: new Map(state.thinkingIds),
    toolAliases: new Map(state.toolAliases),
  };
  const record = event as Record<string, unknown>;

  const setMessages = (
    update: (messages: AgentChatItem[]) => AgentChatItem[],
  ) => {
    next.messages = update(next.messages);
  };

  const updateThinking = (
    id: string,
    update: Partial<Pick<AgentThinkingBlock, "text" | "status">>,
  ) => {
    const index = next.messages.findIndex(
      (message) => isThinking(message) && message.id === id,
    );
    if (index === -1) {
      next.messages = [
        ...next.messages,
        {
          kind: "thinking",
          id,
          text: update.text ?? "",
          status: update.status ?? "streaming",
        },
      ];
      return;
    }

    setMessages((messages) =>
      messages.map((message, messageIndex) =>
        messageIndex === index && isThinking(message)
          ? { ...message, ...update }
          : message,
      ),
    );
  };

  const updateTool = (
    id: string,
    update: Partial<
      Pick<AgentToolCall, "name" | "arguments" | "output" | "status">
    >,
  ) => {
    const index = next.messages.findIndex(
      (message) => isToolCall(message) && message.id === id,
    );
    if (index === -1) {
      next.messages = [
        ...next.messages,
        {
          kind: "tool",
          id,
          name: update.name ?? "Tool",
          arguments: update.arguments ?? "",
          output: update.output ?? "",
          status: update.status ?? "streaming",
        },
      ];
      return;
    }

    setMessages((messages) =>
      messages.map((message, messageIndex) =>
        messageIndex === index && isToolCall(message)
          ? { ...message, ...update }
          : message,
      ),
    );
  };

  const beginAssistant = () => {
    if (!next.currentAssistantId) {
      next.assistantCounter += 1;
      next.currentAssistantId = `assistant-${next.assistantCounter}`;
    }
    const id = next.currentAssistantId;
    if (!next.messages.some((message) => message.id === id)) {
      next.messages = [...next.messages, { id, role: "assistant", text: "" }];
    }
    return id;
  };

  const toolIdFor = (contentIndex: unknown) =>
    `tool-${next.currentAssistantId ?? `assistant-${next.assistantCounter}`}-${String(contentIndex ?? 0)}`;

  const thinkingIdFor = (contentIndex: unknown) => {
    const key = String(contentIndex ?? 0);
    const existing = next.thinkingIds.get(key);
    if (existing) return existing;
    next.thinkingCounter += 1;
    const id = `thinking-${next.currentAssistantId ?? `assistant-${next.assistantCounter}`}-${next.thinkingCounter}`;
    next.thinkingIds.set(key, id);
    return id;
  };

  // Tool-call IDs in message events do not always match execution IDs, so keep aliases.
  const toolIdForExecution = (toolCallId: unknown) => {
    if (typeof toolCallId === "string") {
      return next.toolAliases.get(toolCallId) ?? toolCallId;
    }
    next.toolCounter += 1;
    return `tool-execution-${next.toolCounter}`;
  };

  if (event.type === "response") {
    // Responses update control state; streamed message events are handled below.
    if (record.command === "get_messages" && record.success === true) {
      next.messages = compactAgentHistory(asRecord(record.data)?.messages);
      return next;
    }
    if (record.success === false) return next;

    if (record.command === "set_model") {
      const model = asModel(record.data);
      if (model) next.selectedModel = modelKey(model);
      return next;
    }

    if (record.command === "get_state") {
      const data = asRecord(record.data);
      const model = asModel(data?.model);
      if (model) next.selectedModel = modelKey(model);
      if (isThinkingLevel(data?.thinkingLevel)) {
        next.thinkingLevel = data.thinkingLevel;
      }
      return next;
    }

    if (record.command === "get_available_models") {
      const data = asRecord(record.data);
      next.models = Array.isArray(data?.models)
        ? data.models.flatMap((model) => {
            const parsed = asModel(model);
            return parsed ? [parsed] : [];
          })
        : [];
      return next;
    }

    if (record.command === "get_available_thinking_levels") {
      const data = asRecord(record.data);
      next.thinkingLevels = Array.isArray(data?.levels)
        ? data.levels.filter(isThinkingLevel)
        : [];
    }
    return next;
  }

  if (event.type === "message_start") {
    if (asRecord(record.message)?.role === "assistant") {
      next.currentAssistantId = `assistant-${next.assistantCounter + 1}`;
      next.assistantCounter += 1;
      next.currentAssistantHasText = false;
      next.thinkingIds = new Map();
    }
    return next;
  }

  if (event.type === "message_update") {
    // One assistant message can contain text, thinking, and tool-call deltas.
    const update = asRecord(record.assistantMessageEvent);
    if (!update) return next;

    if (update.type === "text_delta" && typeof update.delta === "string") {
      const id = beginAssistant();
      next.currentAssistantHasText = true;
      setMessages((messages) =>
        messages.map((message) =>
          message.id === id && !isToolCall(message)
            ? { ...message, text: message.text + update.delta }
            : message,
        ),
      );
      return next;
    }

    if (
      update.type === "thinking_start" ||
      update.type === "thinking_delta" ||
      update.type === "thinking_end"
    ) {
      const id = thinkingIdFor(update.contentIndex);
      if (
        update.type === "thinking_delta" &&
        typeof update.delta === "string"
      ) {
        const current = next.messages.find(
          (message) => isThinking(message) && message.id === id,
        );
        updateThinking(id, {
          text: `${current && isThinking(current) ? current.text : ""}${update.delta}`,
          status: "streaming",
        });
      } else if (
        update.type === "thinking_end" &&
        typeof update.content === "string"
      ) {
        updateThinking(id, { text: update.content, status: "done" });
      } else {
        updateThinking(id, { status: "streaming" });
      }
      return next;
    }

    if (
      update.type !== "toolcall_start" &&
      update.type !== "toolcall_delta" &&
      update.type !== "toolcall_end"
    ) {
      return next;
    }

    const id = toolIdFor(update.contentIndex);
    const partial = asRecord(update.partial);
    const toolCall = asRecord(update.toolCall);
    updateTool(id, {
      name:
        typeof toolCall?.name === "string"
          ? toolCall.name
          : typeof partial?.name === "string"
            ? partial.name
            : toolName(toolCall ?? partial),
    });

    if (update.type === "toolcall_delta" && typeof update.delta === "string") {
      setMessages((messages) =>
        messages.map((message) =>
          isToolCall(message) && message.id === id
            ? { ...message, arguments: message.arguments + update.delta }
            : message,
        ),
      );
    }

    if (update.type === "toolcall_end") {
      if (typeof toolCall?.id === "string") {
        next.toolAliases.set(toolCall.id, id);
      }
      const argumentsText = formatValue(toolCall?.arguments);
      updateTool(id, {
        name: toolName(toolCall),
        status: "running",
        ...(argumentsText ? { arguments: argumentsText } : {}),
      });
    }
    return next;
  }

  if (event.type === "message_end") {
    const message = asRecord(record.message);
    if (message?.role !== "assistant") return next;
    const text = textFromMessage(message);
    if (text && !next.currentAssistantHasText) {
      const id = beginAssistant();
      next.currentAssistantHasText = true;
      setMessages((messages) =>
        messages.map((entry) =>
          entry.id === id && !isToolCall(entry) ? { ...entry, text } : entry,
        ),
      );
    }
    if (next.thinkingIds.size > 0) {
      const thinkingIds = new Set(next.thinkingIds.values());
      setMessages((messages) =>
        messages.map((entry) =>
          isThinking(entry) && thinkingIds.has(entry.id)
            ? { ...entry, status: "done" }
            : entry,
        ),
      );
    }
    next.thinkingIds = new Map();
    next.currentAssistantId = undefined;
    next.currentAssistantHasText = false;
    return next;
  }

  if (event.type === "tool_execution_start") {
    const id = toolIdForExecution(record.toolCallId);
    if (typeof record.toolCallId === "string") {
      next.toolAliases.set(record.toolCallId, id);
    }
    updateTool(id, {
      name: typeof record.toolName === "string" ? record.toolName : "Tool",
      arguments: formatValue(record.args),
      status: "running",
    });
    return next;
  }

  if (event.type === "tool_execution_update") {
    const id = toolIdForExecution(record.toolCallId);
    const partialResult = asRecord(record.partialResult);
    const output = textFromContent(partialResult?.content);
    if (output) updateTool(id, { output, status: "running" });
    return next;
  }

  if (event.type === "tool_execution_end") {
    const id = toolIdForExecution(record.toolCallId);
    const result = asRecord(record.result);
    updateTool(id, {
      output: toolResultText(result),
      status: record.isError === true ? "error" : "done",
    });
  }

  return next;
}
