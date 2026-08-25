import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentManagerEvent } from "@aria/protocol";
import { createBackendService } from "../src";

describe("BackendService", () => {
  it("validates a workspace and emits typed session updates", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aria-core-"));
    const events: AgentManagerEvent[] = [];
    const service = createBackendService({
      onEvent: (event) => events.push(event),
    });

    try {
      const session = await service.createSession(cwd);

      assert.equal(session.cwd, cwd);
      assert.equal(session.status, "idle");
      assert.equal(session.active, false);
      assert.equal(events[0]?.type, "session_update");
      assert.equal(
        events[0]?.type === "session_update" ? events[0].session.id : undefined,
        session.id,
      );
      await assert.rejects(
        service.createSession(join(cwd, "missing")),
        /Workspace must be a directory/,
      );
    } finally {
      service.stopAll();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
