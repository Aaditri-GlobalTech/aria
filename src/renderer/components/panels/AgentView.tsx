import { createEffect, createSignal, For, Show } from "solid-js";
import type {
  AgentChatItem,
  AgentCommand,
  AgentFeedbackRequest,
  AgentFeedbackResponse,
  AgentModel,
  AgentSession,
  AgentStreamingBehavior,
  AgentThinkingBlock,
  AgentToolCall,
} from "../../../shared/agent";
import { modelKey, type SessionClientState } from "./agent-session-state";

function isToolCall(item: AgentChatItem): item is AgentToolCall {
  return "kind" in item && item.kind === "tool";
}

function isThinking(item: AgentChatItem): item is AgentThinkingBlock {
  return "kind" in item && item.kind === "thinking";
}

function toolStatusLabel(status: AgentToolCall["status"]) {
  return {
    streaming: "preparing",
    running: "running",
    done: "done",
    error: "failed",
  }[status];
}

function statusLabel(session: AgentSession) {
  if (session.status === "waiting") return "Waiting for feedback";
  if (session.status === "running") return "Working…";
  if (session.status === "starting") return "Starting Pi…";
  if (session.status === "error") return "Error";
  return session.status === "ready" ? "Ready" : "Idle";
}

function parsedArguments(tool: AgentToolCall) {
  try {
    const value: unknown = JSON.parse(tool.arguments);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function pathFromCwd(path: string, cwd: string) {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedCwd = cwd.replaceAll("\\", "/").replace(/\/$/, "");
  if (normalizedPath === normalizedCwd) return ".";
  if (normalizedPath.startsWith(`${normalizedCwd}/`)) {
    return normalizedPath.slice(normalizedCwd.length + 1);
  }
  return path;
}

function toolPath(tool: AgentToolCall, cwd: string) {
  const args = parsedArguments(tool);
  const path = args?.path ?? args?.filePath ?? args?.file_path;
  return typeof path === "string" ? pathFromCwd(path, cwd) : undefined;
}

function bashCommand(tool: AgentToolCall) {
  const command = parsedArguments(tool)?.command;
  return typeof command === "string" ? command : undefined;
}

function ChatItem(props: {
  item: AgentChatItem;
  cwd: string;
  agentActive: boolean;
}) {
  if (isThinking(props.item)) {
    return (
      <details
        class="agent-thinking"
        open={props.agentActive || props.item.status === "streaming"}
      >
        <summary>
          <span class="agent-thinking-name">Thinking</span>
          <span class="agent-thinking-status">
            {props.item.status === "streaming" ? "working…" : "done"}
          </span>
        </summary>
        <div class="agent-thinking-text">{props.item.text}</div>
      </details>
    );
  }

  if (isToolCall(props.item)) {
    const tool = props.item;
    const path =
      tool.name === "bash" ? bashCommand(tool) : toolPath(tool, props.cwd);
    return (
      <details
        class={`agent-tool-call agent-tool-call-${tool.status}`}
        open={props.agentActive}
      >
        <summary>
          <span class="agent-tool-name">{tool.name}</span>
          <Show when={path}>
            {(value) => (
              <span class="agent-tool-path" title={value()}>
                {value()}
              </span>
            )}
          </Show>
          <span class="agent-tool-status">{toolStatusLabel(tool.status)}</span>
        </summary>
        <div class="agent-tool-body">
          <Show when={tool.name === "bash" && tool.arguments}>
            <div class="agent-tool-section-label">Arguments</div>
            <pre class="agent-tool-code">{tool.arguments}</pre>
          </Show>
          <Show when={tool.output}>
            <div class="agent-tool-section-label">Output</div>
            <pre class="agent-tool-code">{tool.output}</pre>
          </Show>
        </div>
      </details>
    );
  }

  return (
    <article class={`agent-message agent-message-${props.item.role}`}>
      <div class="agent-message-role">
        {props.item.role === "user" ? "You" : "Pi"}
      </div>
      <div class="agent-message-text">{props.item.text}</div>
    </article>
  );
}

type ToolGroup = {
  kind: "tool-group";
  id: string;
  items: AgentToolCall[];
};

type RenderItem = AgentChatItem | ToolGroup;

function isToolGroup(item: RenderItem): item is ToolGroup {
  return "kind" in item && item.kind === "tool-group";
}

function groupToolCalls(items: AgentChatItem[]): RenderItem[] {
  const result: RenderItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isToolCall(item)) {
      result.push(item);
      continue;
    }

    const tools: AgentToolCall[] = [item];
    while (index + 1 < items.length && isToolCall(items[index + 1])) {
      tools.push(items[index + 1] as AgentToolCall);
      index += 1;
    }
    result.push({ kind: "tool-group", id: tools[0].id, items: tools });
  }
  return result;
}

function ToolGroup(props: {
  group: ToolGroup;
  cwd: string;
  agentActive: boolean;
}) {
  return (
    <details class="agent-tool-group" open={props.agentActive}>
      <summary>
        <span>Tool calls</span>
        <span class="agent-tool-group-count">{props.group.items.length}</span>
      </summary>
      <div class="agent-tool-group-body">
        <For each={props.group.items}>
          {(item) => (
            <ChatItem
              item={item}
              cwd={props.cwd}
              agentActive={props.agentActive}
            />
          )}
        </For>
      </div>
    </details>
  );
}

function FeedbackDialog(props: {
  request: AgentFeedbackRequest;
  onRespond: (response: AgentFeedbackResponse) => void;
}) {
  const [value, setValue] = createSignal("");
  const options = () =>
    props.request.method === "select" ? props.request.options : [];
  const confirmMessage = () =>
    props.request.method === "confirm" ? props.request.message : "";
  const placeholder = () =>
    props.request.method === "input" ? props.request.placeholder : undefined;

  createEffect(() => {
    const request = props.request;
    setValue(
      request.method === "editor"
        ? (request.prefill ?? "")
        : request.method === "select"
          ? (request.options[0] ?? "")
          : "",
    );
  });

  const cancel = () =>
    props.onRespond({
      type: "extension_ui_response",
      id: props.request.id,
      cancelled: true,
    });

  return (
    <div class="agent-feedback-backdrop">
      <section class="agent-feedback" role="dialog" aria-modal="true">
        <div class="agent-feedback-title">{props.request.title}</div>
        <Show when={props.request.method === "select"}>
          <select
            class="agent-feedback-select"
            value={value()}
            on:change={(event) => setValue(event.currentTarget.value)}
          >
            <For each={options()}>
              {(option) => <option value={option}>{option}</option>}
            </For>
          </select>
          <div class="agent-feedback-actions">
            <button type="button" on:click={cancel}>
              Cancel
            </button>
            <button
              class="agent-feedback-primary"
              type="button"
              on:click={() =>
                props.onRespond({
                  type: "extension_ui_response",
                  id: props.request.id,
                  value: value(),
                })
              }
            >
              Continue
            </button>
          </div>
        </Show>
        <Show when={props.request.method === "confirm"}>
          <p class="agent-feedback-message">{confirmMessage()}</p>
          <div class="agent-feedback-actions">
            <button type="button" on:click={cancel}>
              Cancel
            </button>
            <button
              type="button"
              on:click={() =>
                props.onRespond({
                  type: "extension_ui_response",
                  id: props.request.id,
                  confirmed: false,
                })
              }
            >
              No
            </button>
            <button
              class="agent-feedback-primary"
              type="button"
              on:click={() =>
                props.onRespond({
                  type: "extension_ui_response",
                  id: props.request.id,
                  confirmed: true,
                })
              }
            >
              Yes
            </button>
          </div>
        </Show>
        <Show
          when={
            props.request.method === "input" ||
            props.request.method === "editor"
          }
        >
          <textarea
            class="agent-feedback-input"
            rows={props.request.method === "editor" ? 8 : 3}
            placeholder={placeholder()}
            value={value()}
            on:input={(event) => setValue(event.currentTarget.value)}
          />
          <div class="agent-feedback-actions">
            <button type="button" on:click={cancel}>
              Cancel
            </button>
            <button
              class="agent-feedback-primary"
              type="button"
              on:click={() =>
                props.onRespond({
                  type: "extension_ui_response",
                  id: props.request.id,
                  value: value(),
                })
              }
            >
              Continue
            </button>
          </div>
        </Show>
      </section>
    </div>
  );
}

export type AgentViewProps = {
  tabs: AgentSession[];
  selectedSession?: AgentSession;
  state?: SessionClientState;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewSession: () => void;
  onDraft: (value: string) => void;
  onPrompt: (
    message: string,
    streamingBehavior?: AgentStreamingBehavior,
  ) => void;
  onAbort: () => void;
  onCommand: (command: AgentCommand) => void;
  onRespond: (response: AgentFeedbackResponse) => void;
};

export function AgentView(props: AgentViewProps) {
  const busy = () =>
    props.selectedSession?.status === "starting" ||
    props.selectedSession?.status === "running" ||
    props.selectedSession?.status === "waiting";
  const running = () => props.selectedSession?.status === "running";
  const inputDisabled = () =>
    props.selectedSession?.status === "starting" ||
    props.selectedSession?.status === "waiting";
  const agentActive = () =>
    props.selectedSession?.status === "running" ||
    props.selectedSession?.status === "waiting";
  const draft = () => props.state?.draft ?? "";
  const feedback = () => props.selectedSession?.waiting;
  const sessionStatus = () =>
    props.selectedSession ? statusLabel(props.selectedSession) : "";
  const [streamingBehavior, setStreamingBehavior] =
    createSignal<AgentStreamingBehavior>("steer");

  const send = () => {
    const message = draft().trim();
    if (message && !inputDisabled()) {
      props.onPrompt(message, running() ? streamingBehavior() : undefined);
    }
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    send();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    send();
  };

  const selectModel = (event: Event) => {
    const value =
      event.currentTarget instanceof HTMLSelectElement
        ? event.currentTarget.value
        : "";
    const separator = value.indexOf("/");
    if (separator === -1) return;
    props.onCommand({
      type: "set_model",
      provider: value.slice(0, separator),
      modelId: value.slice(separator + 1),
    });
  };

  const selectThinkingLevel = (event: Event) => {
    const value =
      event.currentTarget instanceof HTMLSelectElement
        ? event.currentTarget.value
        : "";
    if (
      value !== "off" &&
      value !== "minimal" &&
      value !== "low" &&
      value !== "medium" &&
      value !== "high" &&
      value !== "xhigh" &&
      value !== "max"
    ) {
      return;
    }
    props.onCommand({ type: "set_thinking_level", level: value });
  };

  return (
    <section id="view" class="panel view-panel agent-view">
      <div class="agent-view-tabs">
        <For each={props.tabs}>
          {(tab) => (
            <div
              class={`agent-view-tab ${tab.id === props.selectedSession?.id ? "is-active" : ""}`}
            >
              <button type="button" on:click={() => props.onSelectTab(tab.id)}>
                <span
                  class={`agent-status-dot agent-status-dot-${tab.status}`}
                />
                <span>{tab.name ?? tab.title}</span>
              </button>
              <button
                class="agent-view-tab-close"
                type="button"
                aria-label={`Close ${tab.name ?? tab.title}`}
                on:click={() => props.onCloseTab(tab.id)}
              >
                <span class="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>
          )}
        </For>
        <button
          class="agent-view-new-tab"
          type="button"
          aria-label="New session"
          title="New session"
          on:click={props.onNewSession}
        >
          <span class="codicon codicon-add" aria-hidden="true" />
        </button>
      </div>

      <Show
        when={props.selectedSession && props.state}
        fallback={
          <div class="agent-view-empty">
            Select a session to open its stream.
          </div>
        }
      >
        <div class="agent-view-toolbar">
          <div class="agent-view-session-title">
            <strong>
              {props.selectedSession?.name ?? props.selectedSession?.title}
            </strong>
            <span title={props.selectedSession?.cwd}>
              {props.selectedSession?.cwd}
            </span>
          </div>
          <div class="agent-view-controls">
            <select
              aria-label="Model"
              value={props.state?.selectedModel}
              disabled={busy() || props.state?.models.length === 0}
              on:change={selectModel}
            >
              <Show when={props.state?.models.length === 0}>
                <option value="">Loading models…</option>
              </Show>
              <For each={props.state?.models ?? []}>
                {(model: AgentModel) => (
                  <option value={modelKey(model)}>
                    {model.name ?? model.id}
                  </option>
                )}
              </For>
            </select>
            <select
              aria-label="Thinking level"
              value={props.state?.thinkingLevel}
              disabled={busy() || props.state?.thinkingLevels.length === 0}
              on:change={selectThinkingLevel}
            >
              <Show when={props.state?.thinkingLevels.length === 0}>
                <option value="">Loading levels…</option>
              </Show>
              <For each={props.state?.thinkingLevels ?? []}>
                {(level) => <option value={level}>{level}</option>}
              </For>
            </select>
            <span
              class={`agent-view-status agent-view-status-${props.selectedSession?.status}`}
            >
              {sessionStatus()}
            </span>
            <Show when={props.selectedSession?.status === "running"}>
              <button class="agent-stop" type="button" on:click={props.onAbort}>
                Stop
              </button>
            </Show>
          </div>
        </div>

        <div class="agent-view-messages">
          <Show
            when={(props.state?.messages.length ?? 0) > 0}
            fallback={
              <p class="agent-empty">Ask Pi to work on this project.</p>
            }
          >
            <For each={groupToolCalls(props.state?.messages ?? [])}>
              {(item) =>
                isToolGroup(item) ? (
                  <ToolGroup
                    group={item}
                    cwd={props.selectedSession?.cwd ?? ""}
                    agentActive={agentActive()}
                  />
                ) : (
                  <ChatItem
                    item={item}
                    cwd={props.selectedSession?.cwd ?? ""}
                    agentActive={agentActive()}
                  />
                )
              }
            </For>
          </Show>
        </div>

        <div class="agent-view-composer">
          <form on:submit={submit}>
            <textarea
              class="agent-input"
              aria-label="Message Pi"
              placeholder="Ask Pi…"
              rows="3"
              value={draft()}
              disabled={inputDisabled()}
              on:input={(event) => props.onDraft(event.currentTarget.value)}
              on:keydown={handleKeyDown}
            />
            <div class="agent-composer-footer">
              <Show when={running()}>
                <label class="agent-streaming-mode">
                  <span>Send as</span>
                  <select
                    aria-label="Streaming behavior"
                    value={streamingBehavior()}
                    on:change={(event) =>
                      setStreamingBehavior(
                        event.currentTarget.value as AgentStreamingBehavior,
                      )
                    }
                  >
                    <option value="steer">Steer</option>
                    <option value="followUp">Follow up</option>
                  </select>
                </label>
              </Show>
              <span class="agent-hint">
                Enter sends · Shift+Enter adds a line
              </span>
              <button
                class="agent-submit"
                type="submit"
                disabled={inputDisabled() || !draft().trim()}
              >
                Send
              </button>
            </div>
          </form>
        </div>
        <Show when={feedback()}>
          {(request) => (
            <FeedbackDialog request={request()} onRespond={props.onRespond} />
          )}
        </Show>
      </Show>
    </section>
  );
}
