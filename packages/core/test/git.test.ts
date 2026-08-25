import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGitStatus } from "../src/git";

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
