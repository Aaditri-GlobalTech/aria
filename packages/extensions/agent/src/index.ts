import type {
  ExtensionContext,
  ExtensionDefinition,
  JsonValue,
} from "@aria/core";
import { AgentService } from "./service";
import type { AgentManagerEvent } from "./types";

export { piEnvironment } from "./pi-environment";
export { createRpcLineReader } from "./rpc";
export { AgentService } from "./service";
export * from "./types";

/** Public capability names owned by the Agent extension. */
export const AGENT_CAPABILITIES = [
  "agent.list",
  "agent.create",
  "agent.open",
  "agent.close",
  "agent.prompt",
  "agent.abort",
  "agent.command",
  "agent.respond",
] as const;

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function publishManagerEvent(
  context: ExtensionContext,
  event: AgentManagerEvent,
): void {
  context.publish({ type: "agent.manager", payload: asJson(event) });
}

function registerCapabilities(
  context: ExtensionContext,
  service: AgentService,
): Array<() => void> {
  return [
    context.provide("agent.list", async (payload) => {
      if (payload !== null)
        throw new Error("agent.list does not accept a payload");
      return asJson(await service.listSessions());
    }),
    context.provide("agent.create", (payload) =>
      service.createSession(asRecord(payload)?.cwd).then(asJson),
    ),
    context.provide("agent.open", (payload) =>
      service.openSession(asRecord(payload)?.sessionId).then(asJson),
    ),
    context.provide("agent.close", (payload) => {
      service.closeSession(asRecord(payload)?.sessionId);
      return null;
    }),
    context.provide("agent.prompt", async (payload) => {
      await service.prompt(payload);
      return null;
    }),
    context.provide("agent.abort", (payload) => {
      service.abort(asRecord(payload)?.sessionId);
      return null;
    }),
    context.provide("agent.command", async (payload) => {
      await service.command(payload);
      return null;
    }),
    context.provide("agent.respond", (payload) => {
      service.respond(payload);
      return null;
    }),
  ];
}

function asRecord(value: JsonValue): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Main-process extension so Pi child processes stay inside the host. */
export const agentExtension: ExtensionDefinition = {
  id: "agent",
  execution: "main",
  capabilities: AGENT_CAPABILITIES,
  create(context) {
    const service = new AgentService({
      onEvent: (event) => publishManagerEvent(context, event),
    });
    let cleanups: Array<() => void> = [];
    return {
      start() {
        cleanups = registerCapabilities(context, service);
      },
      stop() {
        service.stopAll();
        for (const cleanup of cleanups.reverse()) cleanup();
        cleanups = [];
      },
    };
  },
};

export default agentExtension;
