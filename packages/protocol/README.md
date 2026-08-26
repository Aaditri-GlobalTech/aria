# `@aria/protocol`

Generic contracts for communication between an application and an extension
host.

The protocol uses JSON-RPC 2.0 messages framed as one JSON object per line. It
contains only host control operations, extension runtime events, and opaque
capability payloads. Agent, Git, Filesystem, Terminal, and other feature
schemas belong to their extensions or the application, not this package.

## Host operations

```text
initialize
host.ping
host.shutdown
extension.list
capability.request
extension.start
extension.stop
```

A capability request has this shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "capability.request",
  "params": {
    "capability": "example.echo",
    "payload": { "value": 1 }
  }
}
```

Extension runtime lifecycle and extension events are sent as `runtime.event`
notifications.

## Development

```sh
bun run --cwd packages/protocol test
bun run --cwd packages/protocol typecheck
bun run --cwd packages/protocol check
```
