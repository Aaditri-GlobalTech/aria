# Host client examples

These examples show how to connect an application to the generic
`@aria/host` JSON-RPC service. They do not add feature-specific protocol
methods; capabilities are requested by name and carry opaque JSON payloads.
Run the commands below from the repository root.

| File | Use | Starts a host? |
| --- | --- | --- |
| `node.ts` | Reusable Node/Bun `HostClient` library | Yes, unless a transport is injected |
| `electron.ts` | Electron main-process client and IPC bridge | Yes |
| `cli.ts` | Raw JSON-RPC client over stdio | Yes, from the source entrypoint |
| `local.ts` | Client for an existing Unix socket or Windows named pipe | No |
| `websocket.ts` | Client for an existing text WebSocket host | No |

The host needs extension sources if capability requests should do anything.
With no sources, initialization succeeds with an empty extension list.

## `node.ts`: reusable client

Import `HostClient` from the example module when an application wants a
request-oriented API instead of constructing JSON-RPC messages itself:

```ts
import { HostClient } from "@aria/host/examples/node";

const client = new HostClient({
  hostSourcePath: "packages/host/src/main.ts",
  hostCwd: process.cwd(),
  extensionSources: ["packages/extensions/agent", "packages/extensions/workspace"],
});

await client.start();
console.log(await client.extensions());
console.log(await client.request("workspace.readDirectory", {
  cwd: process.cwd(),
  path: "",
}));
await client.stop();
```

When `hostSourcePath` is set, the client runs that entrypoint with
`hostRuntime` (default `bun`). Otherwise it resolves the packaged executable
from `resourcesPath/host/aria-host[.exe]`. A spawned host uses a unique local
socket by default. Use `stdio: true` to use the spawned process's stdio, or
provide an already-connected `transport` to avoid spawning a host.

Useful options include:

- `extensionSources`: repeatable extension files or package directories passed
  to a spawned host.
- `ariaDirectory`: host storage location.
- `hostCwd`: working directory and base for relative source paths.
- `onEvent`: receives validated `RuntimeEvent` notifications.
- `requestTimeoutMs`, `startupTimeoutMs`, and `shutdownTimeoutMs`: operation
  time limits.
- `localSocketPath`: endpoint to use instead of the generated socket.

The public client methods are:

| Method | Behavior |
| --- | --- |
| `start()` | Spawns/connects and completes `initialize`. |
| `request(capability, payload?)` | Calls `capability.request`; default payload is `null`. |
| `ping()` | Returns `"pong"`. |
| `extensions()` | Lists extension snapshots. |
| `stop()` | Requests `host.shutdown` and closes the transport. |

`request`, `ping`, and `extensions` start the client automatically. A
`HostRpcError` is thrown for a JSON-RPC error response; it exposes `code` and
`data`.

## `electron.ts`: Electron main process

Use this adapter in the main process, never in the renderer. It creates a
per-launch local socket under Electron's `userData` directory on Unix and a
per-launch named pipe on Windows:

```ts
import { app, ipcMain } from "electron";
import {
  createElectronHostClient,
  registerHostClient,
} from "@aria/host/examples/electron";

const host = createElectronHostClient(app, {
  extensionSources: [
    "packages/extensions/agent",
    "packages/extensions/workspace",
  ],
  onEvent: (event) => mainWindow?.webContents.send("runtime:event", event),
});

registerHostClient(ipcMain, host);
await host.start();
```

`createElectronHostClient` accepts the Node client options except for
`transport` and `stdio`; it selects a local socket or named pipe automatically.
Provide `localSocketPath` to choose a known endpoint. Stop the host from Electron's
`before-quit` handler so Pi children and storage close cleanly.

`registerHostClient` registers these `ipcMain.handle` channels:

| Channel | Operation |
| --- | --- |
| `host:ping` | Host health check |
| `extension:list` | Extension snapshots |
| `capability:request` | Validates a capability name and JSON payload, then forwards it |

The bridge intentionally exposes only the minimal `HostClientApi`; add
application-specific renderer handlers in the application rather than widening
this reusable example.

## `cli.ts`: raw stdio client

`cli.ts` starts `packages/host/src/main.ts` with Bun and `--stdio`, parses the
newline-delimited JSON-RPC output, validates the initialization response, pings
the host, lists extensions, and shuts it down:

```sh
bun run packages/host/examples/cli.ts
```

Pass compatible host arguments after `--`:

```sh
bun run packages/host/examples/cli.ts -- \
  --aria-directory /tmp/aria-example \
  --extension-source packages/extensions/agent \
  --extension-source packages/extensions/workspace
```

The client logs normal results to stdout and runtime event types/diagnostics to
stderr. Do not pass `--socket-path` or a second `--stdio`; this example already
selects stdio. It is a source-oriented diagnostic client, not a packaged host
launcher.

## `local.ts`: Unix socket or named pipe

Start the executable separately with a local endpoint and explicit extensions:

```sh
bun run packages/host/src/main.ts \
  --socket-path /tmp/aria-host.sock \
  --extension-source packages/extensions/agent \
  --extension-source packages/extensions/workspace
```

Then connect from another process:

```sh
bun run packages/host/examples/local.ts /tmp/aria-host.sock
```

On Windows, pass the named-pipe path used by the host, for example
`\\.\pipe\aria-host`. `local.ts` injects the connected transport into
`HostClient`; it does not spawn, configure, or stop the server process. It
initializes the host, prints the advertised extension IDs, and closes its
client connection.

## `websocket.ts`: existing WebSocket host

The WebSocket example also expects a host server to exist. This repository does
not provide an HTTP/WebSocket server. The server must accept a text WebSocket,
wrap it, and embed `ExtensionHost`:

```ts
import { ExtensionHost, WebSocketTransport } from "@aria/host";

async function handleConnection(socket: WebSocket) {
  const host = new ExtensionHost({
    extensionSources: ["/path/to/extensions"],
    transport: new WebSocketTransport(socket),
  });
  await host.start();
}
```

Run the client against that server:

```sh
bun run packages/host/examples/websocket.ts ws://127.0.0.1:3000
```

The URL defaults to `ws://127.0.0.1:3000`. The client waits for the socket to
open, injects `WebSocketTransport` into `HostClient`, initializes the host,
prints extension IDs, and closes the connection. WebSocket messages are whole
JSON strings; they are not newline-framed.
