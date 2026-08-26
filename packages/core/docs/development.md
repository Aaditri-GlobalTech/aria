# Developing Core

Core is Bun-first TypeScript. Work from the repository root, but keep changes
inside `packages/core` unless a package contract requires a root dependency or
lockfile update.

## Source layout

| File | Responsibility |
| --- | --- |
| `src/runtime.ts` | Extension registry, lifecycle, leases, and routing |
| `src/commands.ts` | Public command and result types plus validation |
| `src/events.ts` | Live event bus |
| `src/discovery.ts` | File/package discovery and definition normalization |
| `src/execution.ts` | Worker and child-process boundaries |
| `src/bootstrap.ts` | Code running inside an isolated boundary |
| `src/messages.ts` | Boundary message types and TypeBox validation |
| `src/schemas.ts` | Recursive JSON schema |
| `src/persistence.ts` | Buffered SQLite lease state and recovery |
| `src/types.ts` | Extension SDK and Core event types |

The public package surface is assembled in `src/index.ts`.

## Development loop

Run the package commands from the repository root:

```sh
bun run --cwd packages/core test
bun run --cwd packages/core typecheck
bun run --cwd packages/core check
```

`check` runs Biome over Core source, tests, package metadata, and TypeScript
configuration. It does not validate Markdown, so review documentation changes
manually.

## Writing extension fixtures

Runtime tests normally create temporary module files and use `execution: "main"`
for fast unit coverage:

```ts
const source = await writeModule(
  directory,
  "example.mjs",
  `export default {
    id: "example",
    execution: "main",
    capabilities: ["example.echo"],
    create(context) {
      return {
        start() {
          context.provide("example.echo", (payload) => payload);
        },
        stop() {},
      };
    },
  };`,
);
```

Use `worker` and the default `child` mode when testing boundary behavior.
Always dispatch `shutdown` in a `finally` block so workers, subprocesses,
and persistence timers are released.

Test-only Core instances should use:

```ts
new CoreRuntime({ storagePath: ":memory:" });
```

Persistence tests should use a temporary file path and a short
`persistenceIntervalMs`. Test both interval flushing and shutdown flushing.

## Changing commands or events

When adding or changing a command:

1. Update `CoreCommandMap` and `CoreCommandResultMap`.
2. Update `CoreCommandSchema`.
3. Register the handler in `CoreRuntime`.
4. Add a runtime test for valid and invalid input.
5. Update the README and architecture documentation.
6. Record breaking public changes in `CHANGELOG.md`.

When adding a `CoreEvent` variant, check live consumers. Core persistence stores
only manual lease state; do not add event data to storage without an explicit
privacy and replay decision.

Boundary messages are untrusted input. Update `WireMessageSchema` whenever the
wire union changes and keep validation on both the Core and bootstrap sides.

## Persistence rules

The default database is `~/.aria/host.db`. Core owns the SQLite connection in
the main process; workers and child processes communicate through messages.

Core persists only current manual lease state, not extension instances,
functions, process handles, capability payloads, responses, logs, or arbitrary
extension events. Do not add sensitive or non-replayable data to storage
casually.

The event store buffers lease updates in memory. A process crash can lose
updates that have not reached SQLite. Shutdown must remain the final flush
point.

## Runtime invariants

- Extension IDs are unique.
- Declared dependencies must exist and cannot form cycles.
- A capability has at most one provider.
- A failed dependency fails its dependents.
- An extension stops only when its manual and dependency leases are gone.
- Host event listeners cannot break Core by throwing or rejecting.
- Capability payloads remain JSON values at the Core boundary.

## Verification before submitting a change

```sh
bun run --cwd packages/core check
bun run --cwd packages/core typecheck
bun run --cwd packages/core test
```

If the change affects only documentation, run `git diff --check` and verify all
API names, paths, defaults, and lifecycle claims against the source.
