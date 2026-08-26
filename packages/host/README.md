# `@aria/host`

Reusable Bun extension host for embedding `@aria/core` behind a generic
JSON-RPC transport. The extension host owns the extension runtime, its storage
directories, and its recovery state; it is not an extension and contains no
Agent, Git, Filesystem, Terminal, or MCP behavior.

## Library

```ts
import { ExtensionHost } from "@aria/host";

const host = new ExtensionHost({
  extensionSources: ["/path/to/extensions"],
  input: process.stdin,
  output: process.stdout,
});

await host.start();
```

`ExtensionHost` accepts any Node readable and writable streams, so applications
can embed it in a process, while the executable entrypoint uses stdin and
stdout. Those streams are wrapped by the default `StdioTransport`. Pass a
`JsonRpcTransport` through `transport` to use another message transport, such
as `WebSocketTransport` or `LocalSocketTransport`.

Host storage defaults to `~/.aria`. Starting a host creates:

- `~/.aria/` for host storage;
- `~/.aria/extensions/` for global extensions; and
- `~/.aria/host.db` for manual lease recovery state.

Pass `ariaDirectory` to override the default location. The global extensions
directory is created but is not loaded automatically; pass explicit
`extensionSources` when extensions should be available.

The `manual_leases` table stores extensions that have an active manual start
lease. The extension host restores those extensions after runtime initialization
and clears the leases during a clean shutdown. The extension runtime itself has
no database.

## Executable

```sh
bun run packages/host/src/main.ts \
  --aria-directory /custom/aria \
  --extension-source /path/to/extensions
```

The executable emits JSON-RPC responses and `runtime.event` notifications on
stdout. Diagnostics are written to stderr. Use `--aria-directory` to override
the default `~/.aria` location. Repeat `--extension-source` for each module
file or package directory to load. With no source arguments, the host remains
feature-free while still creating its default storage directories.
The root `build:host` command compiles it to
`app/resources/host/aria-host[.exe]` for packaged applications.

## Client examples

The `examples/` directory contains the reusable Node and Electron bridge
clients, plus standalone CLI and WebSocket clients. Run the CLI from the
repository root:

```sh
bun run packages/host/examples/cli.ts
```

See [`examples/README.md`](examples/README.md) for the Electron wiring and
Host argument examples.

For an already-open WebSocket connection:

```ts
import { ExtensionHost, WebSocketTransport } from "@aria/host";

const host = new ExtensionHost({
  transport: new WebSocketTransport(socket),
});
await host.start();
```

`WebSocketTransport` carries one complete text JSON-RPC message per WebSocket
message. `LocalSocketTransport` uses newline framing over a connected Node
socket; the same adapter works with Unix-domain sockets and Windows named
pipes. Use `connectLocalSocket(path)` when the client should open the local
connection. Plain HTTP is not provided because its request-scoped lifecycle
does not match the host's bidirectional notification stream.

## Development

```sh
bun run --cwd packages/host test
bun run --cwd packages/host typecheck
bun run --cwd packages/host check
```

The integration test loads the Agent and Workspace package directories through
the same `--extension-source` boundary used by development hosts.
