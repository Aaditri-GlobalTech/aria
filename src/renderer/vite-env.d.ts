/// <reference types="vite/client" />

import type {
  AgentCommand,
  AgentFeedbackResponse,
  AgentManagerEvent,
  AgentSession,
  AgentStreamingBehavior,
} from "../shared/agent";
import type { ExplorerEntry, GitStatus } from "../shared/workspace";

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
        readDirectory: (cwd: string, path?: string) => Promise<ExplorerEntry[]>;
        gitStatus: (cwd: string) => Promise<GitStatus>;
        gitStage: (cwd: string, path: string) => Promise<void>;
        gitUnstage: (cwd: string, path: string) => Promise<void>;
        gitCommit: (cwd: string, message: string) => Promise<void>;
      };
    };
  }
}
