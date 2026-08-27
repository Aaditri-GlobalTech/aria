import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { AgentService } from "../src/service";
import type { AgentManagerEvent } from "../src/types";

const temporaryDirectories: string[] = [];

async function createPiFixture(directory: string): Promise<string> {
  const path = join(directory, "pi-fixture.mjs");
  await writeFile(
    path,
    `import { createInterface } from "node:readline";

const sessionFile = process.env.PI_FIXTURE_SESSION_FILE;
const input = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");

input.on("line", (line) => {
  const command = JSON.parse(line);
  if (process.env.PI_FIXTURE_MODE === "malformed") {
    process.stdout.write("not-json\\n");
    return;
  }
  if (command.type === "get_messages") {
    send({ type: "response", id: command.id, command: command.type, success: true, data: { messages: [] } });
    return;
  }
  if (command.type === "get_state") {
    send({ type: "response", id: command.id, command: command.type, success: true, data: { sessionId: "pi-session", sessionFile } });
    return;
  }
  if (command.type === "prompt" && command.message === "delayed") {
    send({ type: "agent_start" });
    setTimeout(() => send({ type: "agent_settled" }), 50);
    return;
  }
  if (command.type === "prompt" && command.message === "delayed-start") {
    setTimeout(() => send({ type: "agent_start" }), 50);
    setTimeout(() => send({ type: "agent_settled" }), 100);
    return;
  }
  if (command.type === "prompt" && command.message === "pending") {
    return;
  }
  if (command.type === "prompt" && command.message === "behavior") {
    send({ type: "fixture_behavior", streamingBehavior: command.streamingBehavior });
    return;
  }
  if (command.type === "prompt" && command.message === "feedback") {
    send({ type: "extension_ui_request", id: "feedback-1", method: "confirm", title: "Continue?", message: "Continue the test" });
    return;
  }
  if (command.type === "extension_ui_response") {
    send({ type: "agent_settled" });
    return;
  }
  if (command.type === "prompt") {
    send({ type: "agent_start" });
    send({ type: "message_start", message: { role: "assistant" } });
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } });
    send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } });
    send({ type: "agent_settled" });
  }
});
`,
    "utf8",
  );
  await chmod(path, 0o755);
  return path;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(predicate(), true);
}

function latestSession(events: AgentManagerEvent[]) {
  return events
    .filter(
      (
        event,
      ): event is Extract<AgentManagerEvent, { type: "session_update" }> =>
        event.type === "session_update",
    )
    .at(-1)?.session;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("AgentService", () => {
  it("validates workspaces and restores Pi session behavior", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-agent-"));
    temporaryDirectories.push(directory);
    const fixture = await createPiFixture(directory);
    const events: AgentManagerEvent[] = [];
    const service = new AgentService({
      onEvent: (event) => events.push(event),
      piCommand: process.execPath,
      piArgs: [fixture],
      environment: {
        ...process.env,
        PI_FIXTURE_SESSION_FILE: join(directory, "session.jsonl"),
      },
    });

    try {
      const session = await service.createSession(directory);
      assert.equal(session.cwd, directory);
      assert.equal(session.title, "new session");
      assert.equal(session.status, "idle");
      assert.equal(session.active, false);
      assert.equal(events[0]?.type, "session_update");

      const opened = await service.openSession(session.id);
      assert.equal(opened.active, true);
      assert.equal(opened.status, "ready");
      assert.equal(opened.piSessionId, "pi-session");

      await service.prompt({ sessionId: session.id, message: "hello" });
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "session_event" &&
            event.event.type === "agent_settled",
        ),
      );
      assert.equal(latestSession(events)?.status, "idle");
      await service.prompt({ sessionId: session.id, message: "delayed-start" });
      assert.equal(latestSession(events)?.status, "running");
      await waitFor(
        () =>
          events.filter(
            (event) =>
              event.type === "session_event" &&
              event.event.type === "agent_settled",
          ).length > 1,
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === "session_event" &&
            event.event.type === "message_update",
        ),
      );
      assert.equal(latestSession(events)?.title, "hello");
      assert.equal(latestSession(events)?.active, true);

      await service.prompt({ sessionId: session.id, message: "feedback" });
      await waitFor(() =>
        events.some((event) => event.type === "feedback_request"),
      );
      await service.respond({
        sessionId: session.id,
        response: {
          type: "extension_ui_response",
          id: "feedback-1",
          confirmed: true,
        },
      });
      await waitFor(
        () =>
          events.filter(
            (event) =>
              event.type === "session_event" &&
              event.event.type === "agent_settled",
          ).length > 2,
      );
      assert.equal(latestSession(events)?.active, true);
      service.closeSession(session.id);
      await waitFor(() => latestSession(events)?.active === false);
    } finally {
      service.stopAll();
    }
  });

  it("marks follow-up prompts as working and preserves steer and follow-up modes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-agent-follow-up-"));
    temporaryDirectories.push(directory);
    const fixture = await createPiFixture(directory);
    const events: AgentManagerEvent[] = [];
    const service = new AgentService({
      onEvent: (event) => events.push(event),
      piCommand: process.execPath,
      piArgs: [fixture],
      environment: process.env,
    });

    try {
      const session = await service.createSession(directory);
      await service.openSession(session.id);
      await service.prompt({ sessionId: session.id, message: "hello" });
      await waitFor(() => latestSession(events)?.status === "idle");
      assert.equal(latestSession(events)?.active, true);

      await service.prompt({ sessionId: session.id, message: "pending" });
      assert.equal(latestSession(events)?.status, "running");
      assert.equal(latestSession(events)?.active, true);

      await service.prompt({
        sessionId: session.id,
        message: "behavior",
        streamingBehavior: "steer",
      });
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "session_event" &&
            event.event.type === "fixture_behavior" &&
            event.event.streamingBehavior === "steer",
        ),
      );

      await service.prompt({
        sessionId: session.id,
        message: "behavior",
        streamingBehavior: "followUp",
      });
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "session_event" &&
            event.event.type === "fixture_behavior" &&
            event.event.streamingBehavior === "followUp",
        ),
      );
    } finally {
      service.stopAll();
    }
  });

  it("waits for a running agent to settle before closing Pi", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-agent-closing-"));
    temporaryDirectories.push(directory);
    const fixture = await createPiFixture(directory);
    const events: AgentManagerEvent[] = [];
    const service = new AgentService({
      onEvent: (event) => events.push(event),
      piCommand: process.execPath,
      piArgs: [fixture],
      environment: process.env,
    });

    try {
      const session = await service.createSession(directory);
      await service.openSession(session.id);
      await service.prompt({ sessionId: session.id, message: "delayed" });
      await waitFor(() =>
        events.some(
          (event) =>
            event.type === "session_event" &&
            event.event.type === "agent_start",
        ),
      );

      service.closeSession(session.id);
      assert.equal(latestSession(events)?.active, true);
      await waitFor(() => latestSession(events)?.active === false);
    } finally {
      service.stopAll();
    }
  });

  it("lists flat and nested persisted sessions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-agent-sessions-"));
    temporaryDirectories.push(directory);
    const sessions = join(directory, "sessions");
    const nested = join(sessions, "workspace");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(sessions, "flat.jsonl"),
      `${JSON.stringify({
        type: "session",
        id: "flat",
        cwd: directory,
        timestamp: "2026-01-02T00:00:00.000Z",
      })}\n${JSON.stringify({
        type: "message",
        timestamp: "2026-01-02T00:01:00.000Z",
        message: { role: "user", content: "first prompt" },
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(nested, "nested.jsonl"),
      `${JSON.stringify({
        type: "session",
        id: "nested",
        cwd: directory,
        timestamp: "2026-01-03T00:00:00.000Z",
      })}\n${JSON.stringify({
        type: "session_info",
        name: "Named session",
      })}\n`,
      "utf8",
    );

    const service = new AgentService({
      environment: {
        ...process.env,
        PI_CODING_AGENT_SESSION_DIR: sessions,
      },
    });
    const listed = await service.listSessions();

    assert.deepEqual(
      listed.map(({ id, title, name }) => ({ id, title, name })),
      [
        { id: "nested", title: "Named session", name: "Named session" },
        { id: "flat", title: "first prompt", name: undefined },
      ],
    );
  });

  it("rejects malformed Pi responses during startup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-agent-malformed-"));
    temporaryDirectories.push(directory);
    const fixture = await createPiFixture(directory);
    const service = new AgentService({
      piCommand: process.execPath,
      piArgs: [fixture],
      environment: {
        ...process.env,
        PI_FIXTURE_MODE: "malformed",
      },
    });
    const session = await service.createSession(directory);

    await assert.rejects(
      service.openSession(session.id),
      /Pi returned invalid RPC data/,
    );
    service.stopAll();
  });

  it("rejects invalid prompts, commands, and workspaces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aria-agent-"));
    temporaryDirectories.push(directory);
    const service = new AgentService();
    const session = await service.createSession(directory);

    await assert.rejects(
      service.createSession(join(directory, "missing")),
      /Workspace must be a directory/,
    );
    await assert.rejects(
      service.prompt({ sessionId: session.id, message: " " }),
      /Prompt must not be empty/,
    );
    await assert.rejects(
      service.command({
        sessionId: session.id,
        command: { type: "unknown" },
      }),
      /Unsupported agent command/,
    );
    await assert.rejects(
      service.command({
        sessionId: session.id,
        command: { type: "set_thinking_level", level: "invalid" },
      }),
      /Thinking level is invalid/,
    );
  });
});
