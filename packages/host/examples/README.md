# Host client examples

- `host-client.ts` contains the stdio client used by the Electron main process.
- `electron-client.ts` registers the Electron `ipcMain` bridge for Host calls.
- `client.ts` is a standalone raw JSON-RPC protocol client.

The raw protocol client can be run from the repository root:

```sh
bun run packages/host/examples/client.ts
```

The Electron bridge is used from the main process, while the renderer only
calls the registered IPC channels:

```ts
import { ipcMain } from "electron";
import { HostClient } from "@aria/host/examples/host-client";
import { registerHostClient } from "@aria/host/examples/electron-client";

const host = new HostClient({
  onEvent: (event) => mainWindow?.webContents.send("core:event", event),
});
registerHostClient(ipcMain, host);
await host.start();
```

Host arguments can be passed to the raw client after `--`:

```sh
bun run packages/host/examples/client.ts -- \
  --aria-directory /tmp/aria-example \
  --extension-source /path/to/extension.mjs
```
