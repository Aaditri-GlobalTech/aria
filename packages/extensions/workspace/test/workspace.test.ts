import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { parseGitStatus, runGit } from "../src/git";
import { WorkspaceService } from "../src/service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Git status parser", () => {
  it("parses staged, unstaged, and untracked files", () => {
    assert.deepEqual(
      parseGitStatus(" M src/app.ts\0A  new.ts\0?? README.md\0"),
      [
        { path: "src/app.ts", indexStatus: " ", worktreeStatus: "M" },
        { path: "new.ts", indexStatus: "A", worktreeStatus: " " },
        { path: "README.md", indexStatus: "?", worktreeStatus: "?" },
      ],
    );
  });
});

describe("WorkspaceService", () => {
  it("reads a workspace directory without exposing .git", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aria-workspace-"));
    temporaryDirectories.push(cwd);
    await mkdir(join(cwd, ".git"));
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "README.md"), "readme", "utf8");

    const service = new WorkspaceService();
    assert.deepEqual(await service.readDirectory({ cwd, path: "" }), [
      { name: "src", path: "src", kind: "directory" },
      { name: "README.md", path: "README.md", kind: "file" },
    ]);
    await assert.rejects(
      service.readDirectory({ cwd, path: "../" }),
      /outside the workspace/,
    );
  });

  it("runs Git status, staging, unstaging, and commit actions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "aria-workspace-git-"));
    temporaryDirectories.push(cwd);
    assert.equal((await runGit(cwd, ["init"])).code, 0);
    assert.equal(
      (await runGit(cwd, ["config", "user.email", "test@example.com"])).code,
      0,
    );
    assert.equal(
      (await runGit(cwd, ["config", "user.name", "Aria Test"])).code,
      0,
    );
    await writeFile(join(cwd, "file.txt"), "content", "utf8");

    const service = new WorkspaceService();
    let status = await service.gitStatus({ cwd });
    assert.equal(status.root, cwd);
    assert.deepEqual(status.changes, [
      { path: "file.txt", indexStatus: "?", worktreeStatus: "?" },
    ]);

    await service.gitStage({ cwd, path: "file.txt" });
    status = await service.gitStatus({ cwd });
    assert.deepEqual(status.changes, [
      { path: "file.txt", indexStatus: "A", worktreeStatus: " " },
    ]);

    await service.gitUnstage({ cwd, path: "file.txt" });
    status = await service.gitStatus({ cwd });
    assert.deepEqual(status.changes, [
      { path: "file.txt", indexStatus: "?", worktreeStatus: "?" },
    ]);

    await assert.rejects(
      service.gitStage({ cwd, path: "../file.txt" }),
      /outside the repository/,
    );
    await service.gitStage({ cwd, path: "file.txt" });
    await service.gitCommit({ cwd, message: "Add file" });
    status = await service.gitStatus({ cwd });
    assert.deepEqual(status.changes, []);
  });
});
