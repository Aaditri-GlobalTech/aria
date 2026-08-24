/** Lifecycle shown for a session while its Pi child is starting or working. */
export type AgentStatus =
  | "starting"
  | "ready"
  | "running"
  | "waiting"
  | "idle"
  | "error";

/** Forward-compatible Pi RPC event; individual event payloads vary by type. */
export type AgentEvent = {
  type: string;
  [key: string]: unknown;
};

/** A request from an extension that must be answered by the renderer. */
export type AgentFeedbackRequest =
  | {
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
    }
  | {
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
    }
  | {
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
    }
  | {
      id: string;
      method: "editor";
      title: string;
      prefill?: string;
    };

/** The response shape Pi expects for an extension UI request. */
export type AgentFeedbackResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

/** Model identity returned by Pi's model discovery command. */
export type AgentModel = {
  provider: string;
  id: string;
  name?: string;
};

export type AgentThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type AgentStreamingBehavior = "steer" | "followUp";

/** Commands deliberately allowed across the renderer/main IPC boundary. */
export type AgentCommand =
  | { type: "get_state" }
  | { type: "get_messages" }
  | { type: "get_available_models" }
  | { type: "get_available_thinking_levels" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: AgentThinkingLevel };

/** Renderer-safe summary of a persisted or active Pi session. */
export type AgentSession = {
  id: string;
  piSessionId?: string;
  cwd: string;
  title: string;
  name?: string;
  status: AgentStatus;
  active: boolean;
  waiting?: AgentFeedbackRequest;
  unread: boolean;
  lastActivity?: string;
};

/** Events emitted by the main-process session manager. */
export type AgentManagerEvent =
  | { type: "sessions"; sessions: AgentSession[] }
  | { type: "session_update"; session: AgentSession }
  | { type: "session_event"; sessionId: string; event: AgentEvent }
  | {
      type: "feedback_request";
      sessionId: string;
      request: AgentFeedbackRequest;
    };

/** Normalized chat item used by the renderer instead of raw Pi messages. */
export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/** A tool invocation with streamed arguments and result output. */
export type AgentToolCall = {
  kind: "tool";
  id: string;
  name: string;
  arguments: string;
  output: string;
  status: "streaming" | "running" | "done" | "error";
};

/** A collapsible assistant reasoning block assembled from deltas. */
export type AgentThinkingBlock = {
  kind: "thinking";
  id: string;
  text: string;
  status: "streaming" | "done";
};

/** Any item the chat view can render in chronological order. */
export type AgentChatItem =
  | AgentChatMessage
  | AgentToolCall
  | AgentThinkingBlock;
