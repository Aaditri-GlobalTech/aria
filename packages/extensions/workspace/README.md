# `@aria/extension-workspace`

`@aria/extension-workspace` provides local filesystem browsing and Git
operations for the Aria extension runtime. It runs in the host's `main`
boundary and exports the `workspace` extension definition plus renderer-safe
Explorer and Git types.

Hosts load the package directory, its `src/index.ts` entrypoint, or a compiled
bundle through `extensionSources`.

## Capabilities

| Capability | Payload | Result |
| --- | --- | --- |
| `workspace.readDirectory` | `{ cwd: string, path?: string }` | `ExplorerEntry[]` |
| `workspace.gitStatus` | `{ cwd: string }` | `GitStatus` |
| `workspace.gitStage` | `{ cwd: string, path: string }` | `null` |
| `workspace.gitUnstage` | `{ cwd: string, path: string }` | `null` |
| `workspace.gitCommit` | `{ cwd: string, message: string }` | `null` |

Every `cwd` must name an existing directory. `workspace.readDirectory` reads
one directory at a time and returns sorted entries:

```ts
type ExplorerEntry = {
  name: string;
  path: string; // relative to cwd
  kind: "file" | "directory";
};
```

The optional `path` is relative to `cwd`; paths outside the workspace are
rejected. `.git` is hidden from Explorer results. Returned paths are relative
to the original workspace root, including when a subdirectory is requested.

## Git behavior

`workspace.gitStatus` finds the repository containing `cwd` and returns:

```ts
type GitStatus = {
  cwd: string;
  root?: string;
  branch?: string;
  changes: GitChange[];
  error?: string;
};
```

A missing Git installation or non-repository workspace is a non-fatal status
result with an `error` and no changes. A failure from Git's status command
includes its error text when available. A detached repository reports `HEAD
detached` as its branch.

`GitChange.indexStatus` and `GitChange.worktreeStatus` are the two porcelain
status columns. `path` is repository-relative. Stage and unstage operations
validate that path against the repository root and invoke Git without a shell;
absolute paths, empty paths, and traversal outside the repository are rejected.
Commits require a non-empty trimmed message and commit the currently staged
changes.

```json
{
  "capability": "workspace.gitStatus",
  "payload": { "cwd": "/workspace/project" }
}
```

The extension returns Git action failures to the caller without stopping the
extension or affecting Explorer access.

## Exports

- `workspaceExtension` is the default extension definition.
- `WORKSPACE_CAPABILITIES` lists the registered capability names.
- `WorkspaceService` exposes the same operations for embedding or tests.
- `runGit` runs a direct Git subprocess and returns its exit code/stdout/stderr.
- `parseGitStatus` converts NUL-delimited porcelain v1 output to `GitChange[]`.
- `ExplorerEntry`, `GitChange`, and `GitStatus` describe capability results.

## Development

```sh
bun run --cwd packages/extensions/workspace test
bun run --cwd packages/extensions/workspace typecheck
bun run --cwd packages/extensions/workspace check
```
