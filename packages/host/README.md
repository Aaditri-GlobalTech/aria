# `@aria/host`

Reusable Bun host for embedding `@aria/core` behind a generic JSON-RPC
transport. The host owns Core; it is not an extension and contains no Agent,
Git, Filesystem, Terminal, or MCP behavior.

## Library

```ts
import { createHost } from "@aria/host";

const host = createHost({
  extensionSources: ["/path/to/extensions"],
  input: process.stdin,
  output: process.stdout,
});

await host.start();
```

`CoreHost` accepts any Node readable and writable streams, so applications can
embed it in a process, while the executable entrypoint uses stdin and stdout.

## Executable

```sh
bun run packages/host/src/main.ts \
  --extension-source /path/to/extensions
```

The executable emits JSON-RPC responses and `core.event` notifications on
stdout. Diagnostics are written to stderr. Repeat `--extension-source` for
each module file or package directory to load. With no source arguments, the
host remains feature-free. The root `build:host` command compiles it to
`app/resources/host/aria-host[.exe]` for packaged applications.

## Development

```sh
bun run --cwd packages/host test
bun run --cwd packages/host typecheck
bun run --cwd packages/host check
```

The integration test loads the Agent and Workspace package directories through
the same `--extension-source` boundary used by development hosts.
