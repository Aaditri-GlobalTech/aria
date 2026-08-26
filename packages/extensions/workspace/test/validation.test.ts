import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { WorkspaceService } from "../src/service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Workspace validation", () => {
  it("requires a directory payload", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aria-workspace-validation-"));
    temporaryDirectories.push(cwd);
    const service = new WorkspaceService();

    await assert.rejects(
      service.readDirectory({ cwd: join(cwd, "missing") }),
      /Workspace must be a directory/,
    );
    await assert.rejects(
      service.gitCommit({ cwd, message: " " }),
      /Commit message must not be empty/,
    );
    await assert.rejects(
      service.readDirectory({ cwd, path: 1 }),
      /path must be a string/,
    );
  });
});
