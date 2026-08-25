# `@aria/host`

The Bun executable entrypoint for Aria's backend sidecar.

## Responsibilities

- Read JSON-RPC 2.0 requests from newline-delimited stdin.
- Dispatch agent, workspace, and Git methods to `@aria/core`.
- Write one JSON-RPC response per request to stdout.
- Forward backend events as `agent.event` notifications.
- Write diagnostics to stderr so stdout remains protocol-only.
- Stop core processes cleanly on `host.shutdown`.

The host has no Electron dependency. Electron starts it as a child process and communicates through stdio.

## Development

Run the source host directly:

```sh
bun run --cwd packages/host start
```

Run its checks:

```sh
bun run --cwd packages/host test
bun run --cwd packages/host typecheck
bun run --cwd packages/host check
```

The host expects JSON-RPC 2.0 messages, one per line. A minimal request is:

```json
{"jsonrpc":"2.0","id":1,"method":"host.ping"}
```

## Executable build

From the repository root:

```sh
bun run build:backend
bun run check:backend
```

The platform-specific Bun single-file executable is generated at:

```text
app/resources/backend/aria-backend
app/resources/backend/aria-backend.exe
```

Electron Builder packages it as `resources/backend/aria-backend[.exe]`.

## Related packages

- [`protocol`](../protocol/README.md)
- [`core`](../core/README.md)
- [`app`](../../app/README.md)
