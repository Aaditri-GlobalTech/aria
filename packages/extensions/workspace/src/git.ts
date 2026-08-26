import { spawn } from "node:child_process";
import type { GitChange } from "./types";

export type GitCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/** Run Git without a shell so workspace paths cannot become commands. */
export function runGit(cwd: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    const command = process.platform === "win32" ? "git.exe" : "git";
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: GitCommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      finish({
        code: -1,
        stdout,
        stderr: error.message,
      });
    });
    child.once("close", (code) => {
      finish({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Parse Git's NUL-delimited porcelain v1 status format. */
export function parseGitStatus(output: string): GitChange[] {
  const changes: GitChange[] = [];
  const records = output.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 3) continue;

    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    const path = record.slice(3);
    if (!path) continue;

    // Rename/copy records include the old path as the following NUL record.
    if (indexStatus === "R" || indexStatus === "C") index += 1;

    changes.push({ path, indexStatus, worktreeStatus });
  }

  return changes;
}
