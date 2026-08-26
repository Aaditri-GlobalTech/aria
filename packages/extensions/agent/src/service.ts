import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { piEnvironment } from "./pi-environment";
import { createRpcLineReader } from "./rpc";
import type {
  AgentCommand,
  AgentEvent,
  AgentFeedbackRequest,
  AgentFeedbackResponse,
  AgentManagerEvent,
  AgentSession,
  AgentStatus,
  AgentStreamingBehavior,
  AgentThinkingLevel,
} from "./types";

/** JSON object shape used for Pi's intentionally open-ended RPC protocol. */
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
  settleTimer?: ReturnType<typeof setTimeout>;
};

type PersistedSession = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  title: string;
  lastActivity?: string;
};

export type AgentServiceOptions = {
  onEvent?: (event: AgentManagerEvent) => void;
  environment?: NodeJS.ProcessEnv;
  piCommand?: string;
  piArgs?: readonly string[];
};

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
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

/** Resolve Pi's session store, allowing deployments to override its location. */
function sessionRoot(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.PI_CODING_AGENT_SESSION_DIR;
  if (configured) {
    return configured.startsWith("~")
      ? join(homedir(), configured.slice(2))
      : resolve(configured);
  }

  const agentDir =
    environment.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
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

function truncate(value: string, length = 80): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** Read only the metadata needed for the sidebar from a JSONL session file. */
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

/** Pi may store sessions flat or one directory deep, so inspect both layouts. */
async function persistedSessionPaths(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const root = sessionRoot(environment);
  let groups: Dirent[];
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

    let files: Dirent[];
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

async function validateDirectory(value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Workspace must be a directory");
  }
  const cwd = resolve(value);
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Workspace must be a directory");
  return cwd;
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

/** Validate commands crossing the renderer-to-Pi boundary. */
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
      !command.provider.trim() ||
      typeof command.modelId !== "string" ||
      !command.modelId.trim())
  ) {
    throw new Error("Model selection is invalid");
  }

  if (
    command.type === "set_thinking_level" &&
    !isThinkingLevel(command.level)
  ) {
    throw new Error("Thinking level is invalid");
  }

  return command as AgentCommand;
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

  const hasValue = typeof response.value === "string";
  const hasConfirmation = typeof response.confirmed === "boolean";
  const cancelled = response.cancelled === true;
  return Number(hasValue) + Number(hasConfirmation) + Number(cancelled) === 1;
}

/** Agent/Pi domain service owned by the Agent extension. */
export class AgentService {
  private readonly onEvent?: (event: AgentManagerEvent) => void;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly piCommand?: string;
  private readonly piArgs: readonly string[];
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(options: AgentServiceOptions = {}) {
    this.onEvent = options.onEvent;
    this.environment = options.environment ?? process.env;
    this.piCommand = options.piCommand;
    this.piArgs = options.piArgs ?? [];
  }

  async listSessions(): Promise<AgentSession[]> {
    await this.refreshPersistedSessions();
    return [...this.sessions.values()]
      .sort((a, b) =>
        (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
      )
      .map(summary);
  }

  async createSession(cwdValue: unknown): Promise<AgentSession> {
    const cwd = await validateDirectory(cwdValue);
    return summary(this.createRecord(cwd));
  }

  async openSession(id: unknown): Promise<AgentSession> {
    return this.activateRecord(this.getRecord(id));
  }

  async prompt(value: unknown): Promise<void> {
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
    await this.promptRecord(
      this.getRecord(input.sessionId),
      input.message.trim(),
      input.streamingBehavior as AgentStreamingBehavior | undefined,
    );
  }

  abort(id: unknown): void {
    const record = this.getRecord(id);
    if (record.child) this.sendRpc(record, { type: "abort" });
  }

  async command(value: unknown): Promise<void> {
    const input = asObject(value);
    const command = validateCommand(input?.command);
    const record = this.getRecord(input?.sessionId);
    await this.ensureRecord(record);
    this.sendRpc(record, command);
    if (command.type === "set_model" || command.type === "set_thinking_level") {
      this.sendRpc(record, {
        id: `state-after-${randomUUID()}`,
        type: "get_state",
      });
    }
  }

  respond(value: unknown): void {
    const input = asObject(value);
    const record = this.getRecord(input?.sessionId);
    const response = this.validateFeedbackResponse(input?.response, record);
    record.waiting = undefined;
    this.setStatus(record, "running");
    this.sendRpc(record, response as unknown as JsonObject);
  }

  stopAll(): void {
    for (const record of this.sessions.values()) this.stopRecord(record);
  }

  private emit(event: AgentManagerEvent): void {
    this.onEvent?.(event);
  }

  private emitSessionUpdate(record: SessionRecord): void {
    this.emit({ type: "session_update", session: summary(record) });
  }

  private emitSessionEvent(record: SessionRecord, event: AgentEvent): void {
    this.emit({ type: "session_event", sessionId: record.id, event });
  }

  private setStatus(record: SessionRecord, status: AgentStatus): void {
    record.status = status;
    record.lastActivity = new Date().toISOString();
    this.emitSessionUpdate(record);
  }

  private async refreshPersistedSessions(): Promise<void> {
    const persisted = (
      await Promise.all(
        (
          await persistedSessionPaths(this.environment)
        ).map((path) => readPersistedSession(path)),
      )
    ).filter((session): session is PersistedSession => session !== null);
    const persistedPaths = new Set(persisted.map((session) => session.path));

    for (const session of persisted) {
      const record = [...this.sessions.values()].find(
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

      this.sessions.set(session.id, {
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

    for (const [id, record] of this.sessions) {
      if (!record.active && record.path && !persistedPaths.has(record.path)) {
        this.sessions.delete(id);
      }
    }
  }

  private createRecord(cwd: string): SessionRecord {
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
    this.sessions.set(record.id, record);
    this.emitSessionUpdate(record);
    return record;
  }

  private getRecord(id: unknown): SessionRecord {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Session id is required");
    }
    const record = this.sessions.get(id);
    if (!record) throw new Error("Session was not found");
    return record;
  }

  private sendRpc(record: SessionRecord, command: JsonObject): void {
    const stdin = record.child?.stdin;
    if (!stdin || stdin.destroyed) throw new Error("Pi is not running");
    stdin.write(`${JSON.stringify(command)}\n`);
  }

  /** Convert one newline-delimited Pi RPC message into manager and UI state. */
  private handleRpcLine(record: SessionRecord, line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      const error = new Error("Pi returned invalid RPC data");
      this.failRecord(record, error);
      this.emitSessionEvent(record, {
        type: "status",
        status: "error",
        message: error.message,
      } as AgentEvent);
      return;
    }

    const event = asObject(value);
    if (!event || typeof event.type !== "string") return;
    const agentEvent = event as AgentEvent;
    record.lastActivity = new Date().toISOString();
    this.emitSessionEvent(record, agentEvent);

    if (event.type === "extension_ui_request") {
      const request = parseFeedbackRequest(event);
      if (request) {
        record.waiting = request;
        this.setStatus(record, "waiting");
        this.emit({
          type: "feedback_request",
          sessionId: record.id,
          request,
        });
      }
      return;
    }

    if (event.type === "agent_start") {
      record.waiting = undefined;
      this.setStatus(record, "running");
      return;
    }

    if (
      event.type === "tool_execution_start" ||
      event.type === "tool_execution_update"
    ) {
      if (!record.waiting) this.setStatus(record, "running");
      return;
    }

    if (event.type === "agent_settled") {
      record.waiting = undefined;
      this.setStatus(record, "idle");
      const child = record.child;
      if (record.settleTimer) clearTimeout(record.settleTimer);
      record.settleTimer = setTimeout(() => {
        record.settleTimer = undefined;
        if (record.child === child) this.stopRecord(record);
      }, 0);
      return;
    }

    if (event.type !== "response") return;

    if (event.command === "get_state" && event.success === true) {
      const data = asObject(event.data);
      if (typeof data?.sessionId === "string") {
        record.piSessionId = data.sessionId;
      }
      if (typeof data?.sessionFile === "string") record.path = data.sessionFile;
      if (typeof data?.sessionName === "string") {
        record.name = data.sessionName;
        record.title = data.sessionName;
      }
      this.emitSessionUpdate(record);
    }

    if (typeof event.id === "string" && record.initPending.delete(event.id)) {
      if (event.success === false) {
        this.failRecord(
          record,
          new Error(
            typeof event.error === "string"
              ? event.error
              : "Pi initialization failed",
          ),
        );
        return;
      }

      if (record.initPending.size === 0) {
        record.resolveReady?.();
        record.resolveReady = undefined;
        record.rejectReady = undefined;
        if (!record.waiting && record.status === "starting") {
          this.setStatus(record, "ready");
        }
      }
    }
  }

  /** Start one short-lived RPC child and wait for its initial state handshake. */
  private startRecord(record: SessionRecord): Promise<void> {
    if (record.settleTimer) {
      clearTimeout(record.settleTimer);
      record.settleTimer = undefined;
    }
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
    this.setStatus(record, "starting");

    try {
      const command =
        this.piCommand ?? (process.platform === "win32" ? "pi.cmd" : "pi");
      const args = [...this.piArgs, "--mode", "rpc"];
      if (record.path) args.push("--session", record.path);
      const child = spawn(command, args, {
        cwd: record.cwd,
        env: piEnvironment(this.environment),
        stdio: ["pipe", "pipe", "pipe"],
      });
      record.child = child;

      const reader = createRpcLineReader((line) =>
        this.handleRpcLine(record, line),
      );
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
        if (!record.stopping) {
          this.failRecord(record, error);
          this.emitSessionEvent(record, {
            type: "status",
            status: "error",
            message: error.message,
          } as AgentEvent);
        }
      });

      child.once("exit", (code, signal) => {
        if (record.child !== child) return;
        record.child = undefined;
        record.active = false;
        if (record.stopping) {
          this.setStatus(record, "idle");
          return;
        }

        const message =
          record.stderr.trim() ||
          `Pi exited${code === null ? ` (${signal})` : ` (${code})`}`;
        this.failRecord(record, new Error(message));
        this.emitSessionEvent(record, {
          type: "status",
          status: "error",
          message,
        } as AgentEvent);
      });

      // Do not expose a session as ready until both history and state are available.
      const messagesId = `init-messages-${randomUUID()}`;
      const stateId = `init-state-${randomUUID()}`;
      record.initPending.add(messagesId);
      record.initPending.add(stateId);
      this.sendRpc(record, { id: messagesId, type: "get_messages" });
      this.sendRpc(record, { id: stateId, type: "get_state" });
    } catch (error) {
      this.failRecord(
        record,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    return record.ready ?? Promise.resolve();
  }

  private failRecord(record: SessionRecord, error: Error): void {
    record.initPending.clear();
    record.rejectReady?.(error);
    record.resolveReady = undefined;
    record.rejectReady = undefined;
    this.setStatus(record, "error");
    this.stopRecord(record);
  }

  /** Stop the child after a settled turn; an unexpected exit remains an error. */
  private stopRecord(record: SessionRecord): void {
    if (record.settleTimer) {
      clearTimeout(record.settleTimer);
      record.settleTimer = undefined;
    }
    const child = record.child;
    record.stopping = true;
    record.child = undefined;
    record.active = false;
    record.waiting = undefined;
    if (child) child.kill();
    if (record.status !== "error") this.setStatus(record, "idle");
  }

  private async ensureRecord(record: SessionRecord): Promise<SessionRecord> {
    await this.startRecord(record);
    return record;
  }

  private async activateRecord(record: SessionRecord): Promise<AgentSession> {
    await this.ensureRecord(record);
    return summary(record);
  }

  private async promptRecord(
    record: SessionRecord,
    message: string,
    streamingBehavior?: AgentStreamingBehavior,
  ): Promise<void> {
    await this.ensureRecord(record);
    this.sendRpc(record, {
      type: "prompt",
      message,
      ...(streamingBehavior ? { streamingBehavior } : {}),
    });
  }

  private validateFeedbackResponse(
    value: unknown,
    record: SessionRecord,
  ): AgentFeedbackResponse {
    if (!isFeedbackResponse(value)) {
      throw new Error("Invalid feedback response");
    }
    if (!record.waiting || record.waiting.id !== value.id) {
      throw new Error("Feedback request is no longer pending");
    }
    if ("cancelled" in value && value.cancelled === true) return value;

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
}

export { persistedSessionPaths, readPersistedSession, sessionRoot };
