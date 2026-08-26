# @aria/core

`@aria/core` is a reusable Bun runtime for loading and running extensions. It
provides the generic parts of the system:

- discovers extension definitions from paths supplied by the host;
- validates dependencies and capability ownership;
- starts extensions in the main process, a worker, or a child process;
- routes lifecycle commands, capability requests, and extension events; and
- records selected lifecycle events for restart recovery.

Core does not contain application features. Pi, Git, Filesystem, Terminal, MCP,
and similar features belong in extensions.

## Quick start

```ts
import { CoreRuntime } from "@aria/core";

const core = new CoreRuntime({
  extensionSources: [
    "/path/to/built-in-extensions",
    "/path/to/user-extensions",
  ],
  onEvent: (event) => {
    console.log(event.type);
  },
});

try {
  await core.dispatch({ type: "initialize" });

  const result = await core.dispatch({
    type: "request",
    capability: "example.echo",
    payload: { value: 1 },
  });

  console.log(result);
} finally {
  await core.dispatch({ type: "shutdown" });
}
```

Core loads no extensions when `extensionSources` is omitted or empty. The host
chooses which built-in and user extensions to make available.

## Writing an extension

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

An extension receives a context with these services:

- `provide(name, handler)` exposes a capability;
- `request(name, payload)` calls another capability;
- `publish(event)` sends an extension event;
- `subscribe(type, listener)` listens for extension events; and
- `log(level, message, details)` reports diagnostics to the host.

Core treats capability payloads as JSON values. The extension that owns a
capability is responsible for validating its feature-specific payload.

## Execution modes

| Mode | Where the extension runs | Default |
| --- | --- | --- |
| `main` | Inside the Core process | No |
| `worker` | A Bun Web Worker | No |
| `child` | A separate Bun process | Yes |

Worker and child extensions complete a `hello` handshake during registration,
then remain ready but idle. Their instances start when a capability is
requested, when the host sends a `start` command, or when a persisted manual
lease is recovered during initialization.

## Commands

All lifecycle operations use the typed `core.dispatch()` boundary:

| Command | Behavior | Result |
| --- | --- | --- |
| `initialize` | Discover, validate, register, and recover extensions | `DiscoveryReport` |
| `start` | Start an extension and acquire a manual lease | `void` |
| `request` | Start a capability provider if needed and invoke it | `JsonValue` |
| `stop` | Release a manual lease and stop the extension if unused | `void` |
| `shutdown` | Stop extensions, dispose boundaries, and flush storage | `void` |

A capability request starts its provider but does not create a manual lease.
That provider remains available until an explicit stop or shutdown. Dependencies
use reference-counted leases, so a shared dependency stops only after its last
running consumer releases it.

## Events

Core emits discovery, lifecycle, capability, failure, persistence, log, and
extension-event notifications through `core.events` or the `onEvent` option:

```ts
const unsubscribe = core.events.on("extension_failed", (event) => {
  console.error(event.extensionId, event.error);
});

// Later:
unsubscribe();
```

Use `"*"` to observe every event. Events are live notifications, not a
replacement for the persisted lifecycle journal. Async listeners are not
awaited by `emit`, and listener failures do not stop Core. Persistence failures
are reported as `persistence_failed` events.

## Persistence

Core uses Bun's built-in SQLite driver and stores the database at:

```text
~/.aria/host.db
```

The `.aria` directory is created during the first initialization. Selected Core
events are buffered in memory and flushed every 1,000 milliseconds by default. Shutdown flushes the remaining buffer. A process crash can lose
recent events that have not been flushed yet.

```ts
const core = new CoreRuntime({
  storagePath: "/custom/path/host.db",
  persistenceIntervalMs: 1000,
});
```

The persisted log restores manual start leases after an unclean restart when
the lease event reached SQLite. A clean shutdown records lease release, so
those extensions do not automatically start in the next process. Core
re-discovers definitions and re-handshakes workers and child processes; it does
not persist functions, instances, or process handles.

Capability payloads, responses, arbitrary extension events, and logs are not
persisted. Use `storagePath: ":memory:"` in tests.

## Discovery and failures

Discovery accepts module files and package directories. Package directories use
their `main` entry or a conventional `index` file. A candidate with an invalid
export is skipped and included in the `DiscoveryReport.issues` list.

Dependencies must refer to registered extension IDs. Capability names must
have one provider. Missing dependencies, dependency cycles, duplicate
capabilities, failed starts, and boundary failures are reported through Core
events and extension snapshots.

## Developer documentation

- [Architecture](docs/architecture.md) — command flow, state, boundaries,
  events, leases, and persistence.
- [Development](docs/development.md) — source layout, extension fixtures,
  testing, and verification commands.

## Development commands

```sh
bun run --cwd packages/core test
bun run --cwd packages/core typecheck
bun run --cwd packages/core check
```
