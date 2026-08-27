# `@aria/protocol`

`@aria/protocol` defines the generic contract between an application and an
extension host. It provides JSON-RPC 2.0 message types, validation, runtime
notifications, and a transport-neutral text interface.

The protocol knows only host control operations and opaque capability payloads.
Agent, Git, Filesystem, Terminal, and other feature schemas belong to their
extensions or application adapters.

## Host methods

Every host call is a JSON-RPC request with an `id`. Host methods accept object
params unless noted otherwise:

| Method | Params | Result |
| --- | --- | --- |
| `initialize` | `{ protocolVersion?: 1 }` | `HostInitializeResult` |
| `host.ping` | none | `"pong"` |
| `host.shutdown` | none | `null` |
| `extension.list` | none | `ExtensionSnapshot[]` |
| `capability.request` | `{ capability, payload }` | Feature-defined JSON value |
| `extension.start` | `{ extensionId }` | `null` |
| `extension.stop` | `{ extensionId }` | `null` |

`initialize` discovers the explicitly configured extension sources and advertises
the methods and notifications supported by the host. `extension.list` returns
the current extension snapshots and also initializes discovery when necessary.

A capability request is intentionally generic:

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

The extension that owns `example.echo` validates the payload. The protocol only
requires `capability` to be a non-empty string and `payload` to be a JSON value.
JSON values may be objects, arrays, strings, finite numbers, booleans, or null.

## Runtime events

The host sends lifecycle, discovery, capability, failure, log, and extension
events as notifications. Every notification uses `runtime.event`:

```json
{
  "jsonrpc": "2.0",
  "method": "runtime.event",
  "params": {
    "type": "extension_started",
    "extensionId": "agent"
  }
}
```

`params` is a generic `RuntimeEvent` from `@aria/core`. Feature events are
carried inside the `extension_event` variant and retain their opaque JSON
payload.

## Validation and errors

Use the validation functions before dispatching untrusted input:

- `parseHostRequestLine` parses one JSON line and validates a supported host
  request.
- `parseJsonRpcLine` parses one JSON line and validates any JSON-RPC call.
- `parseJsonRpcOutboundLine` parses a host response or notification.
- `validateHostRequest`, `validateJsonRpcMessage`,
  `validateJsonRpcResponse`, and `validateJsonRpcNotification` validate parsed
  values.
- `validateHostInitializeResult` checks the host handshake result.
- `validateRuntimeEventNotification` checks the runtime-event envelope.
- `isJsonValue`, `isJsonRpcId`, `isJsonRpcParams`, and `isJsonRpcRequest` are
  non-throwing type guards.

Validation failures throw `JsonRpcProtocolError`, which exposes `code` and
`id`. The exported standard codes are:

| Code | Meaning |
| ---: | --- |
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |

## Encoding and transports

`JsonRpcTransport` carries complete encoded JSON strings. It does not open a
connection, parse JSON, or select framing. The host package supplies adapters
for Node streams, local sockets/named pipes, and text WebSockets.

```ts
import type { JsonRpcTransport } from "@aria/protocol";

function sendMessage(transport: JsonRpcTransport, message: string) {
  return transport.send(message);
}
```

Use `serializeJsonRpcMessage` when the transport already provides message
boundaries. Use `serializeJsonRpcLine` for a raw newline-delimited stream; it
adds exactly one trailing newline. The host's `StdioTransport` and
`LocalSocketTransport` add that framing inside `send`, so pass them the output
of `serializeJsonRpcMessage` rather than a pre-framed line.
`WebSocketTransport` sends one unframed text message per WebSocket message.

`createJsonRpcResult`, `createJsonRpcError`, and `createJsonRpcNotification`
construct the corresponding wire values. `createRuntimeEventNotification`
wraps a Core runtime event as the standard host notification.

## Development

```sh
bun run --cwd packages/protocol test
bun run --cwd packages/protocol typecheck
bun run --cwd packages/protocol check
```
