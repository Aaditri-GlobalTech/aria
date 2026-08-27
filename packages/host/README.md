# `@aria/host`

`@aria/host` embeds `@aria/core` behind a bidirectional JSON-RPC transport. It
owns host storage and manual-lease recovery, but contains no Agent, Git,
Filesystem, Terminal, or MCP behavior. Features are supplied as explicit
extension sources.

## Embed the host

```ts
import { ExtensionHost, StdioTransport } from "@aria/host";

const host = new ExtensionHost({
  extensionSources: ["/path/to/extensions"],
  transport: new StdioTransport({
    input: process.stdin,
    output: process.stdout,
  }),
});

await host.start();
// Serve requests through the selected transport.
```

`transport` is required. `ExtensionHost` does not choose a transport or
implicitly fall back to stdio. `start()` opens storage and begins accepting
messages; the first `initialize` or `extension.list` request initializes the
embedded runtime. Call `await host.stop()` during application shutdown.

### Host options

| Option | Behavior |
| --- | --- |
| `extensionSources` | Module files or package directories passed to Core. An empty list loads no features. |
| `ariaDirectory` | Storage directory; defaults to `~/.aria`. |
| `runtime` | Existing `ExtensionRuntime` to embed instead of creating one. |
| `moduleLoader` | Custom Core module loader, useful for tests. |
| `bootstrapPath` | Worker/child extension bootstrap override. |
| `handshakeTimeoutMs` / `requestTimeoutMs` | Remote extension timeouts. |
| `onError` | Receives diagnostics that must not enter the JSON-RPC stream. |
| `transport` | Required `JsonRpcTransport` implementation. |

The embedded runtime is available as `host.runtime` for direct inspection or
lifecycle dispatch. Direct runtime dispatch does not update the host's
`manual_leases` table; applications normally use the JSON-RPC methods documented
in [`@aria/protocol`](../protocol/README.md).

## Storage and recovery

Starting a host creates:

- `~/.aria/` (or the configured `ariaDirectory`);
- `~/.aria/extensions/` for future/global extension storage; and
- `~/.aria/host.db` for manual-lease recovery.

The global `extensions` directory is not discovered automatically. Pass each
module file or package directory through `extensionSources`.

`extension.start` records a manual lease in `host.db`. The host restores active
leases when it handles `initialize` or `extension.list`, and clears them during
a clean shutdown. Capability requests do not create manual leases. Core keeps
its own lifecycle state in memory.

## Executable

The `aria-host` entrypoint requires exactly one transport mode:

```sh
bun run packages/host/src/main.ts \
  --socket-path /tmp/aria-host.sock \
  --aria-directory /custom/aria \
  --extension-source /path/to/extensions
```

Use `--stdio` for explicit stdin/stdout compatibility:

```sh
bun run packages/host/src/main.ts \
  --stdio \
  --extension-source /path/to/extensions
```

| Option | Description |
| --- | --- |
| `--socket-path <path>` | Listen on a Unix-domain socket or Windows named pipe. |
| `--stdio` | Read and write newline-delimited JSON-RPC on standard streams. |
| `--aria-directory <path>` | Override the host storage directory. |
| `--extension-source <path>` | Add one extension file or package directory; repeat it for multiple sources. |

The executable writes diagnostics to stderr. With no extension sources it stays
feature-free while still creating host storage. The root `build:host` command
compiles it to `app/resources/host/aria-host[.exe]` for packaged applications.

## Transports

The package exports adapters for the transport contract:

| Adapter | Input | Framing |
| --- | --- | --- |
| `StdioTransport` | Node `Readable` and `Writable` streams | One JSON string per newline |
| `LocalSocketTransport` | Connected Node `Duplex` socket/pipe | One JSON string per newline |
| `WebSocketTransport` | Existing open text `WebSocket` | One complete text message |

```ts
import { WebSocketTransport } from "@aria/host";

const transport = new WebSocketTransport(socket);
```

`WebSocketTransport` does not open the socket. `LocalSocketTransport` wraps an
already-connected endpoint; use `connectLocalSocket(path)` when the client
should open a Unix socket or Windows named pipe. Plain HTTP is not included
because the host sends bidirectional runtime notifications over a long-lived
connection.

## Client and examples

The reusable Node client is exported from the example module:

```ts
import { HostClient } from "@aria/host/examples/node";

const client = new HostClient({
  hostSourcePath: "packages/host/src/main.ts",
  hostCwd: process.cwd(),
  extensionSources: ["packages/extensions/agent"],
});

await client.start();
console.log(await client.extensions());
console.log(await client.request("agent.list"));
await client.stop();
```

When no transport is injected, `HostClient` spawns the packaged host or a
source host and uses a unique local socket by default. Set `stdio: true` only
when the client should connect through the spawned process's stdio. Inject
`transport` when the host is already connected. See
[`examples/README.md`](examples/README.md) for the CLI, local socket,
WebSocket, and Electron examples.

## Development

```sh
bun run --cwd packages/host test
bun run --cwd packages/host typecheck
bun run --cwd packages/host check
```
