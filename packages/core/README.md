# @aria/core

`@aria/core` is a reusable Bun extension runtime for loading and running
extensions. It provides the generic parts of the system:

- discovers extension definitions from paths supplied by the host;
- validates dependencies and capability ownership;
- starts extensions in the main process, a worker, or a child process;
- routes lifecycle commands, capability requests, and extension events; and
- emits live events for the host.

The extension runtime does not contain application features. Pi, Git,
Filesystem, Terminal, MCP, and similar features belong in extensions. Hosts
must pass extension sources explicitly; an omitted or empty source list is
feature-free.

## Quick start

```ts
import { ExtensionRuntime } from "@aria/core";

const runtime = new ExtensionRuntime({
  extensionSources: [
    "/path/to/built-in-extensions",
    "/path/to/user-extensions",
  ],
  onEvent: (event) => {
    console.log(event.type);
  },
});

try {
  await runtime.dispatch({ type: "initialize" });

  const result = await runtime.dispatch({
    type: "request",
    capability: "example.echo",
    payload: { value: 1 },
  });

  console.log(result);
} finally {
  await runtime.dispatch({ type: "shutdown" });
}
```

The extension runtime loads no extensions when `extensionSources` is omitted or
empty. The host chooses which built-in and user extensions to make available.
The configured sources must include a provider for `example.echo` in the sample
above. `initialize` is cached, so later commands reuse the same discovery result.

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

- `provide(name, handler)` exposes a capability and returns its cleanup function;
- `request(name, payload)` calls another capability;
- `publish(event)` sends an extension event;
- `subscribe(type, listener)` listens for extension events and returns cleanup;
- `log(level, message, details)` reports diagnostics to the host; and
- `extensionId` identifies the current extension.

The runtime treats capability payloads as JSON values. The extension that owns
a capability is responsible for validating its feature-specific payload.

### Definition fields

| Field | Behavior |
| --- | --- |
| `id` | Required unique extension ID. |
| `execution` | `main`, `worker`, or `child`; defaults to isolated `child`. |
| `dependencies` | Extension IDs started before this extension. |
| `capabilities` | Optional names; a non-empty list restricts registrations. |
| `create(context)` | Creates the lifecycle instance after startup is requested. |

`start()` should register capabilities and subscriptions. `stop()` should
release external resources; the runtime also removes its context bindings.

## Execution modes

| Mode | Where the extension runs | Default |
| --- | --- | --- |
| `main` | Inside the extension runtime process | No |
| `worker` | A Bun Web Worker | No |
| `child` | A separate Bun process | Yes |

Worker and child extensions complete a `hello` handshake during registration,
then remain ready but idle. Their instances start when a capability is
requested or when the host sends a `start` command.

## Commands

All lifecycle operations use the typed `runtime.dispatch()` boundary. Commands
initialize lazily, except after shutdown, and invalid command values reject.

| Command | Behavior | Result |
| --- | --- | --- |
| `initialize` | Discover, validate, and register extensions once | `DiscoveryReport` |
| `start` | Start an extension and acquire one manual lease | `undefined` |
| `request` | Start the unique provider if needed and invoke it | `JsonValue` |
| `stop` | Release the manual lease and stop the extension if unused | `undefined` |
| `shutdown` | Stop extensions and dispose remote boundaries | `undefined` |

A capability request starts its provider but does not create a manual lease.
That provider remains available until an explicit `stop` or `shutdown`.
Dependencies use reference-counted leases, so a shared dependency stops only
after its last running consumer releases it. Repeating `start` does not add a
second manual lease.

## Events

The extension runtime emits discovery, lifecycle, capability, failure, log, and
extension-event notifications through `runtime.events` or the `onEvent` option.
These are live notifications: async listeners are not awaited and listener
failures do not stop the runtime.

```ts
const unsubscribe = runtime.events.on("extension_failed", (event) => {
  console.error(event.extensionId, event.error);
});

// Later:
unsubscribe();
```

Use `"*"` to observe every event. Runtime events cover candidate discovery,
registration/readiness, manual leases, lifecycle changes, failures, capability
registration, extension events, and logs. Manual leases exist only for the
lifetime of the runtime instance; durable recovery belongs to the host.

## Discovery

`discoverExtensions` accepts a module file, a package directory, or a directory
whose immediate entries are module files and package directories. Supported
entry extensions include `.js`, `.mjs`, `.cjs`, `.ts`, and `.tsx`. A module may
export one definition or an array of definitions. Invalid candidates are
skipped and returned in `DiscoveryReport.issues`.

## Storage

The extension runtime owns no durable storage. The host creates its data
directory and stores manual lease recovery state in `host.db`. The runtime
keeps extension state and manual leases in memory while running.

## Failures

A candidate with an invalid export is skipped and included in the
`DiscoveryReport.issues` list.

Dependencies must refer to registered extension IDs. Capability names must
have one provider. Missing dependencies, dependency cycles, duplicate
capabilities, failed starts, and boundary failures are reported through runtime
events and extension snapshots.

## Utility exports

- `discoverExtensions` and `normalizeExtensionExport` load and normalize
  extension definitions.
- `EventBus` provides synchronous notification dispatch with isolated listeners.
- `createJsonLineReader` incrementally reads newline-delimited text.
- `isRuntimeCommand` and `RuntimeCommandSchema` validate runtime commands.

## Developer documentation

- [Architecture](docs/architecture.md) — command flow, state, boundaries,
  events, leases, and storage ownership.
- [Development](docs/development.md) — source layout, extension fixtures,
  testing, and verification commands.

## Development commands

```sh
bun run --cwd packages/core test
bun run --cwd packages/core typecheck
bun run --cwd packages/core check
```
