import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type {
  AgentCommand,
  AgentEvent,
  AgentFeedbackRequest,
  AgentFeedbackResponse,
  AgentManagerEvent,
  AgentSession,
  AgentStatus,
  AgentStreamingBehavior,
} from "../shared/agent";
import { createRpcLineReader } from "./rpc";

const directory = typeof __dirname === "undefined" ? process.cwd() : __dirname;

type JsonObject = Record<string, unknown>;

type SessionRecord = {
  id: string;
  cwd: string;
  path?: string;
  piSessionId?: string;
  title: string;
  name?: string;
  status: AgentStatus;
  active: boolean;
  waiting?: AgentFeedbackRequest;
  lastActivity?: string;
  child?: ChildProcessWithoutNullStreams;
  stopping: boolean;
  stderr: string;
  ready?: Promise<void>;
  resolveReady?: () => void;
  rejectReady?: (error: Error) => void;
  initPending: Set<string>;
};

type PersistedSession = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  title: string;
  lastActivity?: string;
};

let mainWindow: BrowserWindow | undefined;
const sessions = new Map<string, SessionRecord>();

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null
    ? (value as JsonObject)
    : undefined;
}

function sendManagerEvent(event: AgentManagerEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("agent:event", event);
}

function summary(record: SessionRecord): AgentSession {
  return {
    id: record.id,
    piSessionId: record.piSessionId,
    cwd: record.cwd,
    title: record.title,
    name: record.name,
    status: record.status,
    active: record.active,
    waiting: record.waiting,
    unread: false,
    lastActivity: record.lastActivity,
  };
}

function emitSessionUpdate(record: SessionRecord) {
  sendManagerEvent({ type: "session_update", session: summary(record) });
}

function emitSessionEvent(record: SessionRecord, event: AgentEvent) {
  sendManagerEvent({ type: "session_event", sessionId: record.id, event });
}

function setStatus(record: SessionRecord, status: AgentStatus) {
  record.status = status;
  record.lastActivity = new Date().toISOString();
  emitSessionUpdate(record);
}

function sessionRoot() {
  const configured = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (configured) {
    return configured.startsWith("~")
      ? join(homedir(), configured.slice(2))
      : resolve(configured);
  }

  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return join(agentDir, "sessions");
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

function truncate(value: string, length = 80) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

async function readPersistedSession(
  path: string,
): Promise<PersistedSession | null> {
  try {
    const lines = (await readFile(path, "utf8")).split("\n");
    const header = asObject(JSON.parse(lines[0] ?? ""));
    if (
      header?.type !== "session" ||
      typeof header.id !== "string" ||
      typeof header.cwd !== "string"
    ) {
      return null;
    }

    let name: string | undefined;
    let firstPrompt = "";
    let lastActivity =
      typeof header.timestamp === "string" ? header.timestamp : undefined;

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      let entry: JsonObject;
      try {
        entry = asObject(JSON.parse(line)) ?? {};
      } catch {
        continue;
      }

      if (typeof entry.timestamp === "string") lastActivity = entry.timestamp;
      if (entry.type === "session_info" && typeof entry.name === "string") {
        name = entry.name;
      }
      if (entry.type !== "message") continue;

      const message = asObject(entry.message);
      if (message?.role === "user" && !firstPrompt) {
        firstPrompt = textFromContent(message.content);
      }
    }

    return {
      path,
      id: header.id,
      cwd: header.cwd,
      name,
      title: name || truncate(firstPrompt) || basename(path, ".jsonl"),
      lastActivity,
    };
  } catch {
    return null;
  }
}

async function persistedSessionPaths() {
  const root = sessionRoot();
  let groups: Array<import("node:fs").Dirent>;
  try {
    groups = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const group of groups) {
    if (group.isFile() && group.name.endsWith(".jsonl")) {
      paths.push(join(root, group.name));
      continue;
    }
    if (!group.isDirectory()) continue;

    let files: Array<import("node:fs").Dirent>;
    try {
      files = await readdir(join(root, group.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (file.isFile() && file.name.endsWith(".jsonl")) {
        paths.push(join(root, group.name, file.name));
      }
    }
  }
  return paths;
}

async function refreshPersistedSessions() {
  const persisted = (
    await Promise.all(
      (await persistedSessionPaths()).map((path) => readPersistedSession(path)),
    )
  ).filter((session): session is PersistedSession => session !== null);
  const persistedPaths = new Set(persisted.map((session) => session.path));

  for (const session of persisted) {
    const record = [...sessions.values()].find(
      (candidate) => candidate.path === session.path,
    );
    if (record) {
      record.cwd = session.cwd;
      record.piSessionId = session.id;
      record.name = session.name;
      if (!record.child) record.title = session.title;
      record.lastActivity = session.lastActivity ?? record.lastActivity;
      continue;
    }

    sessions.set(session.id, {
      id: session.id,
      cwd: session.cwd,
      path: session.path,
      piSessionId: session.id,
      title: session.title,
      name: session.name,
      status: "idle",
      active: false,
      stopping: false,
      stderr: "",
      initPending: new Set(),
      lastActivity: session.lastActivity,
    });
  }

  for (const [id, record] of sessions) {
    if (!record.active && record.path && !persistedPaths.has(record.path)) {
      sessions.delete(id);
    }
  }
}

function createRecord(cwd: string): SessionRecord {
  const record: SessionRecord = {
    id: randomUUID(),
    cwd,
    title: `${basename(cwd)} session`,
    status: "idle",
    active: false,
    stopping: false,
    stderr: "",
    initPending: new Set(),
  };
  sessions.set(record.id, record);
  emitSessionUpdate(record);
  return record;
}

function getRecord(id: unknown) {
  if (typeof id !== "string") throw new Error("Session id is required");
  const record = sessions.get(id);
  if (!record) throw new Error("Session was not found");
  return record;
}

function sendRpc(record: SessionRecord, command: JsonObject) {
  const stdin = record.child?.stdin;
  if (!stdin || stdin.destroyed) throw new Error("Pi is not running");
  stdin.write(`${JSON.stringify(command)}\n`);
}

function parseFeedbackRequest(value: JsonObject): AgentFeedbackRequest | null {
  if (
    typeof value.id !== "string" ||
    (value.method !== "select" &&
      value.method !== "confirm" &&
      value.method !== "input" &&
      value.method !== "editor") ||
    typeof value.title !== "string"
  ) {
    return null;
  }

  if (
    value.method === "select" &&
    Array.isArray(value.options) &&
    value.options.every((option) => typeof option === "string")
  ) {
    return {
      id: value.id,
      method: value.method,
      title: value.title,
      options: value.options,
      ...(typeof value.timeout === "number" ? { timeout: value.timeout } : {}),
    };
  }

  if (value.method === "confirm" && typeof value.message === "string") {
    return {
      id: value.id,
      method: value.method,
      title: value.title,
      message: value.message,
      ...(typeof value.timeout === "number" ? { timeout: value.timeout } : {}),
    };
  }

  if (value.method === "input") {
    return {
      id: value.id,
      method: value.method,
      title: value.title,
      ...(typeof value.placeholder === "string"
        ? { placeholder: value.placeholder }
        : {}),
      ...(typeof value.timeout === "number" ? { timeout: value.timeout } : {}),
    };
  }

  if (value.method === "editor") {
    return {
      id: value.id,
      method: value.method,
      title: value.title,
      ...(typeof value.prefill === "string" ? { prefill: value.prefill } : {}),
    };
  }

  return null;
}

function isFeedbackResponse(value: unknown): value is AgentFeedbackResponse {
  const response = asObject(value);
  if (
    response?.type !== "extension_ui_response" ||
    typeof response.id !== "string"
  ) {
    return false;
  }

  return (
    typeof response.value === "string" ||
    typeof response.confirmed === "boolean" ||
    response.cancelled === true
  );
}

function handleRpcLine(record: SessionRecord, line: string) {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    setStatus(record, "error");
    emitSessionEvent(record, {
      type: "status",
      status: "error",
      message: "Pi returned invalid RPC data",
    });
    return;
  }

  const event = asObject(value);
  if (!event || typeof event.type !== "string") return;
  const agentEvent = event as AgentEvent;
  record.lastActivity = new Date().toISOString();
  emitSessionEvent(record, agentEvent);

  if (event.type === "extension_ui_request") {
    const request = parseFeedbackRequest(event);
    if (request) {
      record.waiting = request;
      setStatus(record, "waiting");
      sendManagerEvent({
        type: "feedback_request",
        sessionId: record.id,
        request,
      });
    }
    return;
  }

  if (event.type === "agent_start") {
    record.waiting = undefined;
    setStatus(record, "running");
    return;
  }

  if (
    event.type === "tool_execution_start" ||
    event.type === "tool_execution_update"
  ) {
    if (!record.waiting) setStatus(record, "running");
    return;
  }

  if (event.type === "agent_settled") {
    record.waiting = undefined;
    setStatus(record, "idle");
    setTimeout(() => stopRecord(record), 0);
    return;
  }

  if (event.type !== "response") return;

  if (event.command === "get_state" && event.success === true) {
    const data = asObject(event.data);
    if (typeof data?.sessionId === "string")
      record.piSessionId = data.sessionId;
    if (typeof data?.sessionFile === "string") record.path = data.sessionFile;
    if (typeof data?.sessionName === "string") {
      record.name = data.sessionName;
      record.title = data.sessionName;
    }
    emitSessionUpdate(record);
  }

  if (typeof event.id === "string" && record.initPending.delete(event.id)) {
    if (event.success === false) {
      record.rejectReady?.(
        new Error(
          typeof event.error === "string"
            ? event.error
            : "Pi initialization failed",
        ),
      );
      record.initPending.clear();
      return;
    }

    if (record.initPending.size === 0) {
      record.resolveReady?.();
      record.resolveReady = undefined;
      record.rejectReady = undefined;
      if (!record.waiting && record.status === "starting") {
        setStatus(record, "ready");
      }
    }
  }
}

function startRecord(record: SessionRecord) {
  if (record.child) return record.ready ?? Promise.resolve();

  record.stopping = false;
  record.active = true;
  record.waiting = undefined;
  record.stderr = "";
  record.initPending = new Set();
  record.ready = new Promise<void>((resolveReady, rejectReady) => {
    record.resolveReady = resolveReady;
    record.rejectReady = rejectReady;
  });
  setStatus(record, "starting");

  try {
    const command = process.platform === "win32" ? "pi.cmd" : "pi";
    const args = ["--mode", "rpc"];
    if (record.path) args.push("--session", record.path);
    const child = spawn(command, args, {
      cwd: record.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    record.child = child;

    const reader = createRpcLineReader((line) => handleRpcLine(record, line));
    child.stdout.on("data", (chunk) => reader.push(chunk));
    child.stdout.once("end", () => reader.end());
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      record.stderr = `${record.stderr}${chunk}`.slice(-4000);
    });

    child.once("error", (error) => {
      if (record.child !== child) return;
      record.child = undefined;
      record.active = false;
      record.rejectReady?.(error);
      record.resolveReady = undefined;
      record.rejectReady = undefined;
      if (!record.stopping) {
        setStatus(record, "error");
        emitSessionEvent(record, {
          type: "status",
          status: "error",
          message: error.message,
        });
      }
    });

    child.once("exit", (code, signal) => {
      if (record.child !== child) return;
      record.child = undefined;
      record.active = false;
      if (record.stopping) {
        setStatus(record, "idle");
        return;
      }

      record.rejectReady?.(
        new Error(
          record.stderr.trim() ||
            `Pi exited${code === null ? ` (${signal})` : ` (${code})`}`,
        ),
      );
      record.resolveReady = undefined;
      record.rejectReady = undefined;
      setStatus(record, "error");
      emitSessionEvent(record, {
        type: "status",
        status: "error",
        message:
          record.stderr.trim() ||
          `Pi exited${code === null ? ` (${signal})` : ` (${code})`}`,
      });
    });

    const messagesId = `init-messages-${randomUUID()}`;
    const stateId = `init-state-${randomUUID()}`;
    record.initPending.add(messagesId);
    record.initPending.add(stateId);
    sendRpc(record, { id: messagesId, type: "get_messages" });
    sendRpc(record, { id: stateId, type: "get_state" });
  } catch (error) {
    record.active = false;
    record.rejectReady?.(
      error instanceof Error ? error : new Error(String(error)),
    );
    record.resolveReady = undefined;
    record.rejectReady = undefined;
    setStatus(record, "error");
  }

  return record.ready;
}

function stopRecord(record: SessionRecord) {
  const child = record.child;
  record.stopping = true;
  record.child = undefined;
  record.active = false;
  record.waiting = undefined;
  if (child) child.kill();
  if (record.status !== "error") setStatus(record, "idle");
}

async function ensureRecord(record: SessionRecord) {
  await startRecord(record);
  return record;
}

async function activateRecord(record: SessionRecord) {
  await ensureRecord(record);
  return summary(record);
}

async function promptRecord(
  record: SessionRecord,
  message: string,
  streamingBehavior?: AgentStreamingBehavior,
) {
  await ensureRecord(record);
  sendRpc(record, {
    type: "prompt",
    message,
    ...(streamingBehavior ? { streamingBehavior } : {}),
  });
}

async function validateDirectory(value: unknown) {
  const cwd =
    typeof value === "string" && value ? resolve(value) : process.cwd();
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Workspace must be a directory");
  return cwd;
}

function validateCommand(value: unknown): AgentCommand {
  const command = asObject(value);
  const allowed = new Set([
    "get_state",
    "get_messages",
    "get_available_models",
    "get_available_thinking_levels",
    "set_model",
    "set_thinking_level",
  ]);

  if (
    !command ||
    typeof command.type !== "string" ||
    !allowed.has(command.type)
  ) {
    throw new Error("Unsupported agent command");
  }

  if (
    command.type === "set_model" &&
    (typeof command.provider !== "string" ||
      typeof command.modelId !== "string")
  ) {
    throw new Error("Model selection is invalid");
  }

  if (
    command.type === "set_thinking_level" &&
    typeof command.level !== "string"
  ) {
    throw new Error("Thinking level is invalid");
  }

  return command as AgentCommand;
}

function validateFeedbackResponse(value: unknown, record: SessionRecord) {
  if (!isFeedbackResponse(value)) throw new Error("Invalid feedback response");
  if (!record.waiting || record.waiting.id !== value.id) {
    throw new Error("Feedback request is no longer pending");
  }
  if ((value as { cancelled?: unknown }).cancelled === true) return value;

  if (
    record.waiting.method === "confirm" &&
    typeof (value as { confirmed?: unknown }).confirmed !== "boolean"
  ) {
    throw new Error("Confirmation response is invalid");
  }
  if (
    record.waiting.method !== "confirm" &&
    typeof (value as { value?: unknown }).value !== "string"
  ) {
    throw new Error("Input response is invalid");
  }
  return value;
}

function stopAllRecords() {
  for (const record of sessions.values()) stopRecord(record);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload:
        process.env.ELECTRON_PRELOAD_PATH ??
        join(directory, "../preload/preload.cjs"),
    },
  });
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
    stopAllRecords();
  });

  const syncMaximizedState = () =>
    window.webContents.send("window:maximized", window.isMaximized());
  window.on("maximize", syncMaximizedState);
  window.on("unmaximize", syncMaximizedState);
  window.webContents.on("did-finish-load", syncMaximizedState);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(directory, "../index.html"));
  }
}

ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("agent:list", async () => {
  await refreshPersistedSessions();
  return [...sessions.values()]
    .sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""))
    .map(summary);
});

ipcMain.handle("agent:create", async (_event, cwd: unknown) => {
  const directoryPath = await validateDirectory(cwd);
  return summary(createRecord(directoryPath));
});

ipcMain.handle("agent:open", async (_event, id: unknown) => {
  return activateRecord(getRecord(id));
});

ipcMain.handle("agent:prompt", async (_event, value: unknown) => {
  const input = asObject(value);
  if (typeof input?.message !== "string" || !input.message.trim()) {
    throw new Error("Prompt must not be empty");
  }
  if (
    input.streamingBehavior !== undefined &&
    input.streamingBehavior !== "steer" &&
    input.streamingBehavior !== "followUp"
  ) {
    throw new Error("Streaming behavior is invalid");
  }
  await promptRecord(
    getRecord(input.sessionId),
    input.message.trim(),
    input.streamingBehavior as AgentStreamingBehavior | undefined,
  );
});

ipcMain.handle("agent:abort", (_event, id: unknown) => {
  const record = getRecord(id);
  if (record.child) sendRpc(record, { type: "abort" });
});

ipcMain.handle("agent:command", async (_event, value: unknown) => {
  const input = asObject(value);
  const command = validateCommand(input?.command);
  const record = getRecord(input?.sessionId);
  await ensureRecord(record);
  sendRpc(record, command);
  if (command.type === "set_model" || command.type === "set_thinking_level") {
    sendRpc(record, { id: `state-after-${randomUUID()}`, type: "get_state" });
  }
});

ipcMain.handle("agent:respond", (_event, value: unknown) => {
  const input = asObject(value);
  const record = getRecord(input?.sessionId);
  const response = validateFeedbackResponse(input?.response, record);
  record.waiting = undefined;
  setStatus(record, "running");
  sendRpc(record, response as unknown as JsonObject);
});

ipcMain.handle("workspace:pick", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open workspace",
    properties: ["openDirectory"],
  });
  return result.canceled ? undefined : result.filePaths[0];
});

app.on("before-quit", stopAllRecords);

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
