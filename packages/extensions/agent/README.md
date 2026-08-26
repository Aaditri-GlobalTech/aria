# @aria/extension-agent

Agent/Pi session capabilities for the Aria extension runtime.

The package exports the `agent` extension definition, Pi service helpers, and
renderer-safe Agent types. Hosts load the package directory or `src/index.ts`
through `extensionSources`.

## Capabilities

| Capability | Payload | Result |
| --- | --- | --- |
| `agent.list` | `null` | Persisted and active session summaries |
| `agent.create` | `{ cwd }` | New session summary |
| `agent.open` | `{ sessionId }` | Opened session summary |
| `agent.close` | `{ sessionId }` | `null` |
| `agent.prompt` | `{ sessionId, message, streamingBehavior? }` | `null` |
| `agent.abort` | `{ sessionId }` | `null` |
| `agent.command` | `{ sessionId, command }` | `null` |
| `agent.respond` | `{ sessionId, response }` | `null` |

The extension starts one Pi process in RPC mode for each opened session. It
keeps the process alive after `agent_settled` and stops it when the session is
closed and settled. It validates workspace directories and renderer commands
before writing to Pi. Pi session files are discovered from
`PI_CODING_AGENT_SESSION_DIR`, or from `$PI_CODING_AGENT_DIR/sessions` by
default.

Agent manager updates are published as the `agent.manager` extension event;
the desktop adapter forwards them through the generic `runtime.event` protocol.

## Development

```sh
bun run --cwd packages/extensions/agent test
bun run --cwd packages/extensions/agent typecheck
bun run --cwd packages/extensions/agent check
```
