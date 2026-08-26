# `@aria/protocol`

Generic contracts for communication between an application and a Bun Core host.

The protocol uses JSON-RPC 2.0 messages framed as one JSON object per line. It
contains only host control operations, Core events, and opaque capability
payloads. Agent, Git, Filesystem, Terminal, and other feature schemas belong to
their extensions or the application, not this package.

## Host operations

```text
initialize
host.ping
host.shutdown
core.extensions
core.request
core.start
core.stop
```

A capability request has this shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "core.request",
  "params": {
    "capability": "example.echo",
    "payload": { "value": 1 }
  }
}
```

Core lifecycle and extension events are sent as `core.event` notifications.

## Development

```sh
bun run --cwd packages/protocol test
bun run --cwd packages/protocol typecheck
bun run --cwd packages/protocol check
```
