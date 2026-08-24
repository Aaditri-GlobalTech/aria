/// <reference types="vite/client" />

import type {
  AgentCommand,
  AgentFeedbackResponse,
  AgentManagerEvent,
  AgentSession,
  AgentStreamingBehavior,
} from "../shared/agent";

declare global {
  interface Window {
    electron: {
      ping: () => string;
      window: {
        close: () => void;
        minimize: () => void;
        toggleMaximize: () => void;
        onMaximizedChange: (
          listener: (maximized: boolean) => void,
        ) => () => void;
      };
      agent: {
        list: () => Promise<AgentSession[]>;
        create: (cwd: string) => Promise<AgentSession>;
        open: (sessionId: string) => Promise<AgentSession>;
        prompt: (
          sessionId: string,
          message: string,
          streamingBehavior?: AgentStreamingBehavior,
        ) => Promise<void>;
        abort: (sessionId: string) => Promise<void>;
        command: (sessionId: string, command: AgentCommand) => Promise<void>;
        respond: (
          sessionId: string,
          response: AgentFeedbackResponse,
        ) => Promise<void>;
        onEvent: (listener: (event: AgentManagerEvent) => void) => () => void;
      };
      workspace: {
        pick: () => Promise<string | undefined>;
      };
    };
  }
}
