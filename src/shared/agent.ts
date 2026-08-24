export type AgentStatus =
  | "starting"
  | "ready"
  | "running"
  | "waiting"
  | "idle"
  | "error";

export type AgentEvent = {
  type: string;
  [key: string]: unknown;
};

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

export type AgentFeedbackResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

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

export type AgentCommand =
  | { type: "get_state" }
  | { type: "get_messages" }
  | { type: "get_available_models" }
  | { type: "get_available_thinking_levels" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: AgentThinkingLevel };

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

export type AgentManagerEvent =
  | { type: "sessions"; sessions: AgentSession[] }
  | { type: "session_update"; session: AgentSession }
  | { type: "session_event"; sessionId: string; event: AgentEvent }
  | {
      type: "feedback_request";
      sessionId: string;
      request: AgentFeedbackRequest;
    };

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type AgentToolCall = {
  kind: "tool";
  id: string;
  name: string;
  arguments: string;
  output: string;
  status: "streaming" | "running" | "done" | "error";
};

export type AgentThinkingBlock = {
  kind: "thinking";
  id: string;
  text: string;
  status: "streaming" | "done";
};

export type AgentChatItem =
  | AgentChatMessage
  | AgentToolCall
  | AgentThinkingBlock;
