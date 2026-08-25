# `@aria/core`

Runtime-neutral backend logic for Aria. The package is designed to run inside the Bun host and contains no Electron imports.

## Responsibilities

- Manage Pi session processes and session history.
- Persist and reconstruct session metadata.
- Validate workspaces and read directory entries.
- Read Git status and perform stage, unstage, and commit operations.
- Validate agent commands and feedback responses.
- Emit typed agent/session events through `BackendOptions.onEvent`.

Transport and process-boundary concerns belong in `packages/host`. Native desktop operations such as folder picking remain in `app`.

## Public API

```ts
import { createBackendService } from "@aria/core";

const backend = createBackendService({
  onEvent: (event) => {
    // Forward the event to the client transport.
  },
});
```

`BackendService` exposes session operations (`listSessions`, `createSession`, `openSession`, `prompt`, `abort`, `command`, and `respond`), workspace/Git operations, and `stopAll()` for shutdown.

Pi is resolved from the user's environment and must be available on `PATH` when an agent session is started.

## Development

```sh
bun run --cwd packages/core test
bun run --cwd packages/core typecheck
bun run --cwd packages/core check
```

## Related packages

- [`protocol`](../protocol/README.md)
- [`host`](../host/README.md)
- [`app`](../../app/README.md)
