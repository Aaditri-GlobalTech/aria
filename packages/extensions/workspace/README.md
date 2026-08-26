# @aria/extension-workspace

Workspace filesystem and Git capabilities for the Aria Core runtime.

The package exports the `workspace` extension definition and its renderer-safe
Explorer and Git types. Hosts load the package directory or `src/index.ts`
through `extensionSources`.

## Capabilities

| Capability | Payload | Result |
| --- | --- | --- |
| `workspace.readDirectory` | `{ cwd, path? }` | Sorted Explorer entries |
| `workspace.gitStatus` | `{ cwd }` | Branch and changed-file status |
| `workspace.gitStage` | `{ cwd, path }` | `null` |
| `workspace.gitUnstage` | `{ cwd, path }` | `null` |
| `workspace.gitCommit` | `{ cwd, message }` | `null` |

Directory paths must resolve inside the requested workspace. Explorer results
hide `.git`; Git action paths must be relative to the repository root. Git
status reports a non-repository or unavailable-Git error without failing the
Explorer, while staging, unstaging, and commit failures are returned to the
caller.

## Development

```sh
bun run --cwd packages/extensions/workspace test
bun run --cwd packages/extensions/workspace typecheck
bun run --cwd packages/extensions/workspace check
```
