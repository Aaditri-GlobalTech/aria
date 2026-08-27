import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseGitStatus, runGit } from "./git";
import type { ExplorerEntry, GitStatus } from "./types";

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function validateDirectory(value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Workspace must be a directory");
  }
  const cwd = resolve(value);
  const info = await Bun.file(cwd)
    .stat()
    .catch(() => undefined);
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

  const info = await Bun.file(target)
    .stat()
    .catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new Error("Workspace path must be a directory");
  }

  const entries = await readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name !== ".git")
    .map(
      (entry): ExplorerEntry => ({
        name: entry.name,
        path: relative(root, join(target, entry.name)),
        kind: entry.isDirectory() ? "directory" : "file",
      }),
    )
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

async function getGitRoot(cwdValue: unknown): Promise<string> {
  const status = await getGitStatus(cwdValue);
  if (!status.root) throw new Error(status.error ?? "Git repository not found");
  return status.root;
}

/** Keep renderer-supplied Git paths relative to the validated repository root. */
function validateGitPath(root: string, value: unknown): string {
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
): Promise<void> {
  const root = await getGitRoot(cwdValue);
  const path = validateGitPath(root, pathValue);
  const result = await runGit(root, [action, "--", path]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `Git ${action} failed`);
  }
}

/** Filesystem and Git service exposed by the Workspace extension. */
export class WorkspaceService {
  /** Read one directory, returning paths relative to the workspace root. */
  async readDirectory(value: unknown): Promise<ExplorerEntry[]> {
    const input = asObject(value);
    if (input?.path !== undefined && typeof input.path !== "string") {
      throw new Error("path must be a string");
    }
    return readWorkspaceDirectory(input?.cwd, input?.path);
  }

  /** Return Git branch and changed-file status without failing Explorer access. */
  gitStatus(value: unknown): Promise<GitStatus> {
    return getGitStatus(asObject(value)?.cwd);
  }

  /** Stage one repository-relative path. */
  gitStage(value: unknown): Promise<void> {
    const input = asObject(value);
    return runGitPathAction(input?.cwd, input?.path, "add");
  }

  /** Remove one repository-relative path from the index. */
  gitUnstage(value: unknown): Promise<void> {
    const input = asObject(value);
    return runGitPathAction(input?.cwd, input?.path, "reset");
  }

  /** Commit the currently staged changes with a non-empty message. */
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
}

export { validateDirectory };
