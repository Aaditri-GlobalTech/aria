import { describe, expect, it } from "vitest";
import { parseGitStatus } from "../src/main/git";

describe("Git status parser", () => {
  it("parses staged, unstaged, and untracked files", () => {
    expect(parseGitStatus(" M src/app.ts\0A  new.ts\0?? README.md\0")).toEqual([
      { path: "src/app.ts", indexStatus: " ", worktreeStatus: "M" },
      { path: "new.ts", indexStatus: "A", worktreeStatus: " " },
      { path: "README.md", indexStatus: "?", worktreeStatus: "?" },
    ]);
  });
});
