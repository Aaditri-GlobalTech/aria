// Keep Node and Electron APIs in the isolated preload; the renderer receives
// only the narrow, typed operations it needs through contextBridge.
import type {
  AgentCommand,
  AgentFeedbackResponse,
  AgentManagerEvent,
  AgentSession,
  AgentStreamingBehavior,
  ExplorerEntry,
  GitStatus,
} from "@aria/protocol";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("aria", {
  ping: () => "pong",
  window: {
    close: () => ipcRenderer.send("window:close"),
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    onMaximizedChange: (listener: (maximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
        listener(maximized);
      ipcRenderer.on("window:maximized", handler);
      return () => ipcRenderer.removeListener("window:maximized", handler);
    },
  },
  // IPC channels are wrapped instead of exposing ipcRenderer directly.
  agent: {
    list: () => ipcRenderer.invoke("agent:list") as Promise<AgentSession[]>,
    create: (cwd: string) =>
      ipcRenderer.invoke("agent:create", cwd) as Promise<AgentSession>,
    open: (sessionId: string) =>
      ipcRenderer.invoke("agent:open", sessionId) as Promise<AgentSession>,
    prompt: (
      sessionId: string,
      message: string,
      streamingBehavior?: AgentStreamingBehavior,
    ) =>
      ipcRenderer.invoke("agent:prompt", {
        sessionId,
        message,
        ...(streamingBehavior ? { streamingBehavior } : {}),
      }),
    abort: (sessionId: string) => ipcRenderer.invoke("agent:abort", sessionId),
    command: (sessionId: string, command: AgentCommand) =>
      ipcRenderer.invoke("agent:command", { sessionId, command }),
    respond: (sessionId: string, response: AgentFeedbackResponse) =>
      ipcRenderer.invoke("agent:respond", { sessionId, response }),
    onEvent: (listener: (event: AgentManagerEvent) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        event: AgentManagerEvent,
      ) => listener(event);
      ipcRenderer.on("agent:event", handler);
      return () => ipcRenderer.removeListener("agent:event", handler);
    },
  },
  // Filesystem and Git operations stay in the main process behind validated IPC.
  workspace: {
    pick: () =>
      ipcRenderer.invoke("workspace:pick") as Promise<string | undefined>,
    readDirectory: (cwd: string, path = "") =>
      ipcRenderer.invoke("workspace:read-directory", { cwd, path }) as Promise<
        ExplorerEntry[]
      >,
    gitStatus: (cwd: string) =>
      ipcRenderer.invoke("workspace:git-status", cwd) as Promise<GitStatus>,
    gitStage: (cwd: string, path: string) =>
      ipcRenderer.invoke("workspace:git-stage", { cwd, path }) as Promise<void>,
    gitUnstage: (cwd: string, path: string) =>
      ipcRenderer.invoke("workspace:git-unstage", {
        cwd,
        path,
      }) as Promise<void>,
    gitCommit: (cwd: string, message: string) =>
      ipcRenderer.invoke("workspace:git-commit", {
        cwd,
        message,
      }) as Promise<void>,
  },
});
