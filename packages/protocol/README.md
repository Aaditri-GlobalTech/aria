# `@aria/protocol`

Shared contracts for communication between the Aria Electron client and Bun host.

## Responsibilities

- Renderer-safe agent and workspace types.
- JSON-RPC 2.0 request, response, error, and notification types.
- Newline-delimited stdio serialization and runtime validation.
- Host method and protocol-version declarations.
- `agent.event` notification validation.

This package has no Electron or Bun runtime dependency. Changes to its wire contracts must be coordinated with both `app` and `packages/host`.

## Usage

```ts
import {
  HOST_METHODS,
  PROTOCOL_VERSION,
  type AgentSession,
} from "@aria/protocol";
```

The current host methods are:

```text
initialize
host.ping
host.shutdown
agent.list
agent.create
agent.open
agent.prompt
agent.abort
agent.command
agent.respond
workspace.readDirectory
workspace.gitStatus
workspace.gitStage
workspace.gitUnstage
workspace.gitCommit
```

## Development

```sh
bun run --cwd packages/protocol typecheck
bun run --cwd packages/protocol check
```

Keep `PROTOCOL_VERSION` stable for compatible changes and increment it for incompatible wire changes.

## Related packages

- [`app`](../../app/README.md)
- [`core`](../core/README.md)
- [`host`](../host/README.md)
