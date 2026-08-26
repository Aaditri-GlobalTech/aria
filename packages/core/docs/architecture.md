# Core architecture

This document is for developers changing Core or writing an extension that
needs to understand its runtime behavior.

## The mental model

Core is a command-in, event-out runtime. Commands change in-memory state;
Core events describe what happened to the host and to other extensions. It is
not a globally ordered command queue.

```text
Host
 │
 │ CoreCommand
 ▼
┌─────────────────────────────────────────────┐
│ CoreRuntime                                  │
│                                             │
│ TypeBox command validation                   │
│ Typed command routing                        │
│ Extension registry and state machine         │
│ Dependency leases                            │
│ Capability router                            │
│ Live event buses                             │
└───────────────┬──────────────┬──────────────┘
                │              │
                │              ├── Core events → host observers
                │              └── Extension events → subscribers
                │
                ├── main extension: Core process
                ├── worker extension: Web Worker
                └── child extension: Bun subprocess
```

Core does not persist extension functions, instances, worker handles, capability
requests, or arbitrary extension payloads.

## Initialization

```text
initialize
   │
   ▼
Discover configured files and packages
   │
   ▼
Normalize definitions
   │
   ▼
Validate IDs, dependencies, and capabilities
   │
   ├── main   → ready
   ├── worker → start boundary and await hello
   └── child  → start boundary and await hello
```

`extensionSources` is explicit. An empty list loads no extensions.

The default discovery loader imports each candidate in the Core process to
read its definition. Worker and child bootstraps import isolated definitions a
second time. Extension module top-level code should therefore be safe to load
in Core and should not start runtime work at import time.

A custom `moduleLoader` can replace the default loader, which is useful for
unit tests and virtual sources.

## Extension state

```text
registered → handshaking → ready → starting → running → stopping → ready
      └───────────────────────────────────────────────┬──────────────┘
                                                      ▼
                                                    failed
```

Main extensions briefly enter `handshaking` during registration but do not
create a remote boundary. Worker and child extensions complete a `hello`
handshake before becoming `ready`.

Starting an extension starts its dependencies first. A failed dependency
fails its dependents. A failed extension is not automatically retried during
the same Core lifetime.

## Commands and dispatch

`CoreRuntime.dispatch()` validates a discriminated `CoreCommand` with TypeBox,
then routes it to the matching typed handler:

```text
CoreCommand
    │
    ▼
TypeBox validation
    │
    ▼
CoreRuntime handler
    │
    ├── initialize
    ├── start
    ├── request
    ├── stop
    └── shutdown
```

The handler is a typed routing layer, not a queue. It does not serialize all
commands or persist command IDs. Per-extension start and stop guards prevent
the common duplicate-start race, but callers should not assume arbitrary
concurrent commands are globally ordered.

## Dependency leases

There are two kinds of leases:

- A manual lease comes from `start` and is removed by `stop` or `shutdown`.
- A dependency lease is held while a running extension depends on another
  extension.

```text
start(A)
  │
  ├── manual lease on A
  ├── dependency lease on B
  └── dependency lease on C
```

An extension stops only when it has no manual lease and no active consumers.
A capability request starts its provider lazily but does not create a manual
lease. A provider started only by a request remains running until explicitly
stopped or shutdown.

## Capability routing

```text
Host or extension
       │
       │ capability + JSON payload
       ▼
Core finds the unique provider
       │
       ├── starts provider and dependencies
       └── invokes local handler or remote boundary
       │
       ▼
JSON response
```

Definitions may declare capabilities before they are provided. The provider
must register the capability during `start`. Core rejects duplicate providers
and capabilities not declared by the extension.

A capability request from an extension includes the requester in Core's
routing stack, preventing a provider from recursively requesting itself.

## Events

Core has two live event buses:

1. `core.events` emits `CoreEvent` values to the host.
2. The extension event bus routes `context.publish()` values to local and
   subscribed remote extensions.

```text
Extension.publish(event)
          │
          ▼
Core adds source ID
          │
          ├── CoreEvent: extension_event
          ├── local main-extension listeners
          └── subscribed worker/child boundaries
```

`EventBus.emit()` is synchronous only for dispatching listeners. Promise
results are not awaited, and listener failures are isolated so they do not
break the emitter.

Events are notifications, not commands. An extension cannot change Core state
by emitting a lifecycle event.

## Worker and child boundaries

```text
                    postMessage / structured clone
Core ◄────────────────────────────────────────────► Worker
 │
 │ stdin/stdout JSON Lines
 ▼
Child Bun process
```

Boundary messages are validated with the TypeBox `WireMessageSchema` on both
sides. The protocol supports:

- `hello`, `command`, and `response` for lifecycle calls;
- `invoke` and `request` for capability calls;
- `event`, `subscribe`, and `unsubscribe` for event routing;
- capability registration messages; and
- log messages.

Boundary startup is eager for the handshake and lazy for the extension
instance. A boundary failure marks the extension failed and rejects pending
calls.

## Storage

Core owns no durable storage. Extension state and manual leases live only in
memory for the lifetime of the Core instance. The Host owns the `~/.aria`
directory, the `host.db` manual-lease recovery state, and the global
`extensions` directory.

## Failure model

- Invalid discovery candidates are skipped and returned in
  `DiscoveryReport.issues`.
- Missing dependencies, dependency cycles, and duplicate capability
  declarations fail registration.
- Start, stop, and boundary errors emit `extension_failed`.
- A failed extension's dependents are failed as well.
- Host event listeners cannot stop Core by throwing or rejecting.

## Non-goals

Core intentionally does not provide:

- application-specific capabilities;
- durable replay of arbitrary capability calls;
- persistence for extension-owned state;
- a global command queue;
- distributed coordination; or
- automatic rollback of external side effects.
