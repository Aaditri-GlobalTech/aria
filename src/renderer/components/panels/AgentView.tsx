/** Render the normalized chat stream, controls, and extension feedback dialog. */
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

function displayToolPath(path: string, cwd: string) {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedCwd = cwd.replaceAll("\\", "/").replace(/\/$/, "");
  const absolutePath =
    normalizedPath === "~" ||
    normalizedPath.startsWith("~/") ||
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedPath)
      ? normalizedPath
      : normalizedCwd
        ? `${normalizedCwd}/${normalizedPath}`
        : normalizedPath;
  return absolutePath.replace(/^\/home\/[^/]+/, "~");
}

function toolPath(tool: AgentToolCall, cwd: string) {
  const args = parsedArguments(tool);
  const path = args?.path ?? args?.filePath ?? args?.file_path;
  return typeof path === "string" ? displayToolPath(path, cwd) : undefined;
}

function bashCommand(tool: AgentToolCall) {
  const command = parsedArguments(tool)?.command;
  return typeof command === "string" ? command : undefined;
}

function toolOutput(tool: AgentToolCall) {
  if (tool.name === "write") {
    const content = parsedArguments(tool)?.content;
    if (typeof content === "string") return content;
  }
  return tool.output;
}

function ChatItem(props: { item: AgentChatItem; cwd: string }) {
  if (isThinking(props.item)) {
    return <div class="agent-thinking">{props.item.text}</div>;
  }

  if (isToolCall(props.item)) {
    const tool = props.item;
    const path =
      tool.name === "bash" ? bashCommand(tool) : toolPath(tool, props.cwd);
    const command = path ? `${tool.name} ${path}` : tool.name;
    const output = toolOutput(tool);
    const showPrompt = !["read", "edit", "write"].includes(tool.name);
    return (
      <article class={`agent-tool-call agent-tool-call-${tool.status}`}>
        <div class="agent-tool-command">
          <Show when={showPrompt}>
            <span class="agent-tool-prompt">$</span>
          </Show>
          <span>{command}</span>
        </div>
        <Show when={output}>
          <pre class="agent-tool-output">{output}</pre>
        </Show>
      </article>
    );
  }

  return (
    <article class={`agent-message agent-message-${props.item.role}`}>
      <div class="agent-message-text">{props.item.text}</div>
    </article>
  );
}

/** Adapt Pi's extension request contract to native form controls. */
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
  const draft = () => props.state?.draft ?? "";
  const feedback = () => props.selectedSession?.waiting;
  const sessionStatus = () =>
    props.selectedSession ? statusLabel(props.selectedSession) : "";
  const [streamingBehavior, setStreamingBehavior] =
    createSignal<AgentStreamingBehavior>("steer");

  const send = () => {
    // Running turns can be steered or queued; idle turns always start normally.
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
    // Select values are provider/modelId pairs produced by modelKey().
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
            <For each={props.state?.messages ?? []}>
              {(item) => (
                <ChatItem item={item} cwd={props.selectedSession?.cwd ?? ""} />
              )}
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
