/** Renderer-safe filesystem and Git data exchanged over the preload bridge. */
export type ExplorerEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

export type GitChange = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
};

export type GitStatus = {
  cwd: string;
  root?: string;
  branch?: string;
  changes: GitChange[];
  error?: string;
};
