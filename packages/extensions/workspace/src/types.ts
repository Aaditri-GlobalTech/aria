/** One file or directory returned by `workspace.readDirectory`. */
export type ExplorerEntry = {
  name: string;
  /** Path relative to the requested workspace root. */
  path: string;
  kind: "file" | "directory";
};

/** One entry from Git porcelain status output. */
export type GitChange = {
  /** Path relative to the repository root. */
  path: string;
  /** Two-character porcelain status column for the index. */
  indexStatus: string;
  /** Two-character porcelain status column for the worktree. */
  worktreeStatus: string;
};

/** Repository status returned by `workspace.gitStatus`. */
export type GitStatus = {
  /** Workspace directory supplied to the capability. */
  cwd: string;
  /** Repository root when `cwd` belongs to a Git repository. */
  root?: string;
  /** Current branch, or `HEAD detached` when no branch is checked out. */
  branch?: string;
  /** Changed paths parsed from Git porcelain output. */
  changes: GitChange[];
  /** Non-fatal status error, such as missing Git or a non-repository workspace. */
  error?: string;
};
