# `@aria/extension-agent`

`@aria/extension-agent` provides Agent/Pi session capabilities for an Aria
extension runtime. It owns Pi process management, session discovery, streamed
RPC events, feedback requests, and transcript normalization. The extension
runs in the host's `main` boundary; each opened session gets its own Pi child
process.

Hosts load the package directory, its `src/index.ts` entrypoint, or a compiled
bundle through `extensionSources`.

## Capabilities

All capability payloads are JSON values. Invalid payloads or unknown session
IDs are rejected by the extension.

| Capability | Payload | Result |
| --- | --- | --- |
| `agent.list` | `null` | `AgentSession[]` |
| `agent.create` | `{ cwd: string }` | New `AgentSession` |
| `agent.open` | `{ sessionId: string }` | Opened `AgentSession` |
| `agent.close` | `{ sessionId: string }` | `null` |
| `agent.prompt` | `{ sessionId, message, streamingBehavior? }` | `null` |
| `agent.abort` | `{ sessionId: string }` | `null` |
| `agent.command` | `{ sessionId, command }` | `null` |
| `agent.respond` | `{ sessionId, response }` | `null` |

`streamingBehavior` is `"steer"` or `"followUp"` and is used only when a
turn is already running. `agent.command` accepts these commands:

```ts
type AgentCommand =
  | { type: "get_state" }
  | { type: "get_messages" }
  | { type: "get_available_models" }
  | { type: "get_available_thinking_levels" }
  | { type: "set_model"; provider: string; modelId: string }
  | {
      type: "set_thinking_level";
      level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    };
```

Feedback responses are one of:

```ts
type AgentFeedbackResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };
```

The response ID must match the pending feedback request. Confirmation requests
require `confirmed`; select, input, and editor requests require `value`.
Pi can ask for feedback in these forms:

| Method | Additional fields |
| --- | --- |
| `select` | `options: string[]` |
| `confirm` | `message: string` |
| `input` | optional `placeholder` |
| `editor` | optional `prefill` |

## Session lifecycle

- `agent.create` validates `cwd` and creates an idle Aria session.
- `agent.open` starts Pi with `--mode rpc`, requests initial messages and state,
  and resolves after both responses arrive.
- `agent.prompt` and `agent.command` start an inactive session before sending
  their Pi RPC command; `agent.respond` answers an already pending request.
- `agent.close` marks the session closed. A settled Pi child stops immediately;
  a running turn is allowed to settle before the child stops.
- Host shutdown stops every active Pi child.

A session remains active after `agent_settled` while it is open, so later prompts
reuse the same Pi process. Closing a session releases that process once its
current turn has settled. An unexpected Pi exit changes the session to `error`
and emits a status event.

### Prompt and queue behavior

An accepted prompt changes the session status to `running` immediately; Pi's
`agent_start` event may arrive asynchronously afterward. A prompt sent while a
turn is running must include `streamingBehavior`:

- `steer` is delivered after the current assistant turn's tools and before the
  next provider request.
- `followUp` waits until the current turn has no remaining tool calls or steer
  messages, then starts the follow-up turn.

Both modes keep the same Pi child active. `agent_settled` means the current run
is finished, not that an open session or its Pi process was closed.

An `AgentSession` contains Aria and Pi IDs, the workspace `cwd`, title/name,
status, active-process state, optional pending feedback, an unread marker, and
an optional ISO `lastActivity` timestamp.

## Session storage and Pi

Persisted Pi JSONL sessions are searched recursively under:

1. `PI_CODING_AGENT_SESSION_DIR`, when set; or
2. `$PI_CODING_AGENT_DIR/sessions`; or
3. `~/.pi/agent/sessions`.

`agent.list` reads only session metadata from those files. The first user prompt
becomes the fallback title; a Pi session name takes precedence. The service
keeps only the latest stderr tail for diagnostics.

Pi must be available as `pi` on Unix or `pi.cmd` on Windows, unless
`AgentServiceOptions.piCommand` supplies another executable. The child inherits
the supplied environment with common user-level npm, Volta, NVM, and local bin
directories added to `PATH`. Aria does not provide Pi itself.

## Events and transcript helpers

The extension publishes an `agent.manager` extension event. The host wraps it
as a generic `runtime.event` notification with source `agent`:

```json
{
  "type": "extension_event",
  "event": {
    "source": "agent",
    "type": "agent.manager",
    "payload": {
      "type": "session_update",
      "session": { "id": "...", "status": "running" }
    }
  }
}
```

`AgentManagerEvent` supports session updates, raw Pi `session_event` values,
feedback requests, and `session_history` chunks. Initial history is compacted
into `AgentChatItem` values and published in chunks of eight items. Streamed
assistant tool-call updates may carry the partial tool call in
`assistantMessageEvent.partial.content[contentIndex]`; execution updates may
carry fresh `args` and partial output in `partialResult`. Consumers should
merge these updates by content/tool-call ID. Use `compactAgentHistory` directly
when an adapter needs the same conversion.

## Exports

- `agentExtension` (also the default export) is the main-process extension
  definition.
- `AGENT_CAPABILITIES` lists the `agent.*` capability names.
- `AgentService` exposes the session implementation for adapters and tests.
- `compactAgentHistory` converts Pi messages to `AgentChatItem[]`.
- `piEnvironment` prepares a GUI-safe Pi child environment.
- `createRpcLineReader` reads Pi's newline-delimited RPC stream.
- Agent session, feedback, event, model, and transcript types are exported.

`AgentServiceOptions` accepts a custom Pi command, extra arguments, environment,
and event callback.

## Development

```sh
bun run --cwd packages/extensions/agent test
bun run --cwd packages/extensions/agent typecheck
bun run --cwd packages/extensions/agent check
```
