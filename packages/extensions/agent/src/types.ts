/** Lifecycle state reported for an Agent session. */
export type AgentStatus =
  | "starting"
  | "ready"
  | "running"
  | "waiting"
  | "idle"
  | "error";

/** Untyped Pi RPC event preserved for renderer-specific handling. */
export type AgentEvent = {
  type: string;
  [key: string]: unknown;
};

/** UI request emitted by Pi while a session is waiting for input. */
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

/** Response sent to the pending Pi feedback request. */
export type AgentFeedbackResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

/** Model advertised by Pi for the active session. */
export type AgentModel = {
  provider: string;
  id: string;
  name?: string;
};

/** Thinking levels accepted by Pi's `set_thinking_level` command. */
export type AgentThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** How a prompt sent during a running turn is queued. */
export type AgentStreamingBehavior = "steer" | "followUp";

/** Control command forwarded to Pi's RPC process. */
export type AgentCommand =
  | { type: "get_state" }
  | { type: "get_messages" }
  | { type: "get_available_models" }
  | { type: "get_available_thinking_levels" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: AgentThinkingLevel };

/** Session summary returned by Agent capabilities and manager events. */
export type AgentSession = {
  /** Aria's session identifier used in capability payloads. */
  id: string;
  /** Pi's persisted session identifier, once the child is ready. */
  piSessionId?: string;
  /** Workspace directory in which Pi runs. */
  cwd: string;
  /** Fallback or persisted display title. */
  title: string;
  /** Optional name assigned by Pi. */
  name?: string;
  /** Current process/turn state. */
  status: AgentStatus;
  /** Whether a Pi child is currently active. */
  active: boolean;
  /** Pending feedback request, when status is `waiting`. */
  waiting?: AgentFeedbackRequest;
  /** Renderer-owned unread marker. */
  unread: boolean;
  /** ISO timestamp of the latest observed activity. */
  lastActivity?: string;
};

/** Events published through the `agent.manager` extension event. */
export type AgentManagerEvent =
  | { type: "sessions"; sessions: AgentSession[] }
  | { type: "session_update"; session: AgentSession }
  | { type: "session_event"; sessionId: string; event: AgentEvent }
  | {
      type: "session_history";
      sessionId: string;
      items: AgentChatItem[];
    }
  | {
      type: "feedback_request";
      sessionId: string;
      request: AgentFeedbackRequest;
    };

/** Normalized user or assistant chat message. */
export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/** Normalized tool invocation and its streamed result. */
export type AgentToolCall = {
  kind: "tool";
  id: string;
  name: string;
  arguments: string;
  output: string;
  status: "streaming" | "running" | "done" | "error";
};

/** Normalized streamed thinking block. */
export type AgentThinkingBlock = {
  kind: "thinking";
  id: string;
  text: string;
  status: "streaming" | "done";
};

/** One renderable item in a compacted session transcript. */
export type AgentChatItem =
  | AgentChatMessage
  | AgentToolCall
  | AgentThinkingBlock;
