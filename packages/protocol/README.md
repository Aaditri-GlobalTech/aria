# `@aria/protocol`

Generic contracts for communication between an application and an extension
host.

The protocol defines JSON-RPC 2.0 messages, validation, and a transport-neutral
text boundary. Stdio frames messages as one JSON object per line; other
transports carry one complete JSON object per message. It contains only host
control operations, extension runtime events, and opaque capability payloads.
Agent, Git, Filesystem, Terminal, and other feature schemas belong to their
extensions or the application, not this package.

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

## Transport boundary

`JsonRpcTransport` carries complete encoded JSON messages. It does not open
connections, parse JSON, or choose framing; concrete adapters belong to the
embedding package:

```ts
import type { JsonRpcTransport } from "@aria/protocol";

const transport: JsonRpcTransport = /* stdio, WebSocket, or another adapter */
```

Use `serializeJsonRpcMessage` for transports that already provide message
framing and `serializeJsonRpcLine` for newline-delimited streams.

## Development

```sh
bun run --cwd packages/protocol test
bun run --cwd packages/protocol typecheck
bun run --cwd packages/protocol check
```
