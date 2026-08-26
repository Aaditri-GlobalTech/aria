# Host client examples

- `node.ts` contains the reusable Node bridge client.
- `electron.ts` registers the reusable Electron `ipcMain` bridge for Host calls.
- `cli.ts` is a standalone raw JSON-RPC protocol client.
- `websocket.ts` is a standalone WebSocket client using the Node bridge.

The raw protocol client can be run from the repository root:

```sh
bun run packages/host/examples/cli.ts
```

The Electron bridge is used from the main process, while the renderer only
calls the registered IPC channels:

```ts
import { ipcMain } from "electron";
import { HostClient } from "@aria/host/examples/node";
import { registerHostClient } from "@aria/host/examples/electron";

const host = new HostClient({
  onEvent: (event) => mainWindow?.webContents.send("runtime:event", event),
});
registerHostClient(ipcMain, host);
await host.start();
```

Host arguments can be passed to the raw client after `--`:

```sh
bun run packages/host/examples/cli.ts -- \
  --aria-directory /tmp/aria-example \
  --extension-source /path/to/extension.mjs
```

The WebSocket client accepts the host URL as its first argument:

```sh
bun run packages/host/examples/websocket.ts ws://127.0.0.1:3000
```
