import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
  AgentCommand,
  AgentEvent,
  AgentFeedbackRequest,
  AgentFeedbackResponse,
  AgentManagerEvent,
  AgentSession,
  AgentStatus,
  AgentStreamingBehavior,
  ExplorerEntry,
  GitStatus,
} from "@aria/protocol";
import { parseGitStatus, runGit } from "./git";
import { piEnvironment } from "./pi-environment";
import { createRpcLineReader } from "./rpc";

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
};

type PersistedSession = {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  title: string;
  lastActivity?: string;
};

export type BackendOptions = {
  onEvent?: (event: AgentManagerEvent) => void;
};

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null
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

async function validateDirectory(value: unknown) {
  const cwd =
    typeof value === "string" && value ? resolve(value) : process.cwd();
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Workspace must be a directory");
  return cwd;
}

/** Read one Explorer directory while keeping paths inside its workspace root. */
async function readWorkspaceDirectory(
  cwdValue: unknown,
  relativePathValue: unknown,
): Promise<ExplorerEntry[]> {
  const root = await validateDirectory(cwdValue);
  const relativePath =
    typeof relativePathValue === "string" ? relativePathValue : "";
  const target = resolve(root, relativePath);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Workspace path is outside the workspace");
  }

  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory())
    throw new Error("Workspace path must be a directory");

  const entries = await readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name !== ".git")
    .map((entry) => {
      const kind: ExplorerEntry["kind"] = entry.isDirectory()
        ? "directory"
        : "file";
      return {
        name: entry.name,
        path: relative(root, join(target, entry.name)),
        kind,
      };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Adapt Git's repository status to the renderer's Source Control model. */
async function getGitStatus(cwdValue: unknown): Promise<GitStatus> {
  const cwd = await validateDirectory(cwdValue);
  const rootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0) {
    return {
      cwd,
      changes: [],
      error:
        rootResult.code === -1
          ? "Git is not installed or unavailable."
          : "This workspace is not a Git repository.",
    };
  }

  const root = resolve(rootResult.stdout.trim());
  const [branchResult, statusResult] = await Promise.all([
    runGit(root, ["branch", "--show-current"]),
    runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  if (statusResult.code !== 0) {
    return {
      cwd,
      root,
      changes: [],
      error: statusResult.stderr.trim() || "Unable to read Git status.",
    };
  }

  return {
    cwd,
    root,
    branch: branchResult.stdout.trim() || "HEAD detached",
    changes: parseGitStatus(statusResult.stdout),
  };
}

async function getGitRoot(cwdValue: unknown) {
  const status = await getGitStatus(cwdValue);
  if (!status.root) throw new Error(status.error ?? "Git repository not found");
  return status.root;
}

/** Keep renderer-supplied Git paths relative to the validated repository root. */
function validateGitPath(root: string, value: unknown) {
  if (typeof value !== "string" || !value || isAbsolute(value)) {
    throw new Error("Git path is invalid");
  }

  const target = resolve(root, value);
  const pathFromRoot = relative(root, target);
  if (
    !pathFromRoot ||
    pathFromRoot.startsWith("..") ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("Git path is outside the repository");
  }
  return value;
}

async function runGitPathAction(
  cwdValue: unknown,
  pathValue: unknown,
  action: "add" | "reset",
) {
  const root = await getGitRoot(cwdValue);
  const path = validateGitPath(root, pathValue);
  const result = await runGit(root, [action, "--", path]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `Git ${action} failed`);
  }
}

/** Allowlist commands crossing the renderer-to-Pi boundary. */
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

/** Backend/domain service used by the Electron adapter and future Bun host. */
export class BackendService {
  private readonly onEvent?: (event: AgentManagerEvent) => void;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(options: BackendOptions = {}) {
    this.onEvent = options.onEvent;
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

  readWorkspaceDirectory(value: unknown): Promise<ExplorerEntry[]> {
    const input = asObject(value);
    return readWorkspaceDirectory(input?.cwd, input?.path);
  }

  getGitStatus(cwd: unknown): Promise<GitStatus> {
    return getGitStatus(cwd);
  }

  gitStage(value: unknown): Promise<void> {
    const input = asObject(value);
    return runGitPathAction(input?.cwd, input?.path, "add");
  }

  gitUnstage(value: unknown): Promise<void> {
    const input = asObject(value);
    return runGitPathAction(input?.cwd, input?.path, "reset");
  }

  async gitCommit(value: unknown): Promise<void> {
    const input = asObject(value);
    if (typeof input?.message !== "string" || !input.message.trim()) {
      throw new Error("Commit message must not be empty");
    }

    const root = await getGitRoot(input.cwd);
    const result = await runGit(root, ["commit", "-m", input.message.trim()]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "Git commit failed");
    }
  }

  stopAll(): void {
    for (const record of this.sessions.values()) this.stopRecord(record);
  }

  private emit(event: AgentManagerEvent) {
    this.onEvent?.(event);
  }

  private emitSessionUpdate(record: SessionRecord) {
    this.emit({ type: "session_update", session: summary(record) });
  }

  private emitSessionEvent(record: SessionRecord, event: AgentEvent) {
    this.emit({ type: "session_event", sessionId: record.id, event });
  }

  private setStatus(record: SessionRecord, status: AgentStatus) {
    record.status = status;
    record.lastActivity = new Date().toISOString();
    this.emitSessionUpdate(record);
  }

  private async refreshPersistedSessions() {
    const persisted = (
      await Promise.all(
        (
          await persistedSessionPaths()
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
    if (typeof id !== "string") throw new Error("Session id is required");
    const record = this.sessions.get(id);
    if (!record) throw new Error("Session was not found");
    return record;
  }

  private sendRpc(record: SessionRecord, command: JsonObject) {
    const stdin = record.child?.stdin;
    if (!stdin || stdin.destroyed) throw new Error("Pi is not running");
    stdin.write(`${JSON.stringify(command)}\n`);
  }

  /** Convert one newline-delimited Pi RPC message into manager and UI state. */
  private handleRpcLine(record: SessionRecord, line: string) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.setStatus(record, "error");
      this.emitSessionEvent(record, {
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
      setTimeout(() => this.stopRecord(record), 0);
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
      this.emitSessionUpdate(record);
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
          this.setStatus(record, "ready");
        }
      }
    }
  }

  /** Start one short-lived RPC child and wait for its initial state handshake. */
  private startRecord(record: SessionRecord): Promise<void> {
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
      const command = process.platform === "win32" ? "pi.cmd" : "pi";
      const args = ["--mode", "rpc"];
      if (record.path) args.push("--session", record.path);
      const child = spawn(command, args, {
        cwd: record.cwd,
        env: piEnvironment(),
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
        record.rejectReady?.(error);
        record.resolveReady = undefined;
        record.rejectReady = undefined;
        if (!record.stopping) {
          this.setStatus(record, "error");
          this.emitSessionEvent(record, {
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
          this.setStatus(record, "idle");
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
        this.setStatus(record, "error");
        this.emitSessionEvent(record, {
          type: "status",
          status: "error",
          message:
            record.stderr.trim() ||
            `Pi exited${code === null ? ` (${signal})` : ` (${code})`}`,
        });
      });

      // Do not expose a session as ready until both history and state are available.
      const messagesId = `init-messages-${randomUUID()}`;
      const stateId = `init-state-${randomUUID()}`;
      record.initPending.add(messagesId);
      record.initPending.add(stateId);
      this.sendRpc(record, { id: messagesId, type: "get_messages" });
      this.sendRpc(record, { id: stateId, type: "get_state" });
    } catch (error) {
      record.active = false;
      record.rejectReady?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      record.resolveReady = undefined;
      record.rejectReady = undefined;
      this.setStatus(record, "error");
    }

    return record.ready ?? Promise.resolve();
  }

  /** Stop the child after a settled turn; an unexpected exit remains an error. */
  private stopRecord(record: SessionRecord) {
    const child = record.child;
    record.stopping = true;
    record.child = undefined;
    record.active = false;
    record.waiting = undefined;
    if (child) child.kill();
    if (record.status !== "error") this.setStatus(record, "idle");
  }

  private async ensureRecord(record: SessionRecord) {
    await this.startRecord(record);
    return record;
  }

  private async activateRecord(record: SessionRecord) {
    await this.ensureRecord(record);
    return summary(record);
  }

  private async promptRecord(
    record: SessionRecord,
    message: string,
    streamingBehavior?: AgentStreamingBehavior,
  ) {
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
    if (!isFeedbackResponse(value))
      throw new Error("Invalid feedback response");
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
}

export function createBackendService(options?: BackendOptions): BackendService {
  return new BackendService(options);
}
