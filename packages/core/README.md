# `@aria/core`

`@aria/core` is a reusable, long-running Bun library for hosting extensions. A host embeds `CoreRuntime` and supplies extension sources; Core does not start an Aria sidecar or own application capabilities.

Pi, Git, Filesystem, Terminal, MCP, and other features belong in extensions. Core only knows generic extension IDs, dependencies, execution modes, lifecycle, leases, events, and request/response messages.

## Extension definition

An extension entrypoint exports one definition or an array of definitions:

```ts
import type { ExtensionDefinition } from "@aria/core";

const extension: ExtensionDefinition = {
  id: "example",
  execution: "child",
  capabilities: ["example.echo"],
  create(context) {
    return {
      start() {
        context.provide("example.echo", (payload) => payload);
      },
      stop() {},
    };
  },
};

export default extension;
```

The supported execution modes are `main`, `worker`, and `child`. `child` is the default. A child extension is handshaken during registration, but its instance starts only when its capability is requested or it is explicitly started.

## Runtime

```ts
import { createCore } from "@aria/core";

const core = createCore({
  // The embedding host decides which built-in and user sources to load.
  extensionSources: [
    "/path/to/packages/extension",
    "/path/to/user/extensions",
  ],
  onEvent: (event) => {
    // Observe lifecycle, discovery, and extension events.
  },
});

await core.initialize();
const result = await core.request("example.echo", { value: 1 });
await core.shutdown();
```

Discovery accepts single files and package directories. A package may export one or many definitions. Invalid candidates are reported and skipped.

Registration happens after discovery and dependency validation. Child processes complete a `hello` handshake and remain ready but idle. Execution lazily starts instances. Dependency leases are reference-counted, so shared dependencies stop only after their last active consumer stops.

## Development

```sh
bun run --cwd packages/core test
bun run --cwd packages/core typecheck
bun run --cwd packages/core check
```
