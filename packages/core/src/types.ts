export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type ExecutionMode = "main" | "worker" | "child";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** JSON-safe event emitted by an extension before the runtime adds its source id. */
export type ExtensionEventInput = {
  type: string;
  payload?: JsonValue;
};

export type ExtensionEvent = ExtensionEventInput & {
  source: string;
};

export type ExtensionEventListener = (
  event: ExtensionEvent,
) => void | Promise<void>;

export type CapabilityHandler = (
  payload: JsonValue,
) => JsonValue | Promise<JsonValue>;

/** Services the extension runtime exposes to a running extension instance. */
export type ExtensionContext = {
  readonly extensionId: string;
  publish(event: ExtensionEventInput): void;
  subscribe(type: string, listener: ExtensionEventListener): () => void;
  provide(name: string, handler: CapabilityHandler): () => void;
  request<TResponse extends JsonValue = JsonValue>(
    capability: string,
    payload: JsonValue,
  ): Promise<TResponse>;
  log(level: LogLevel, message: string, details?: JsonValue): void;
};

/** Lifecycle hooks for one extension instance. */
export type ExtensionInstance = {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
};

/** Static metadata the runtime uses to discover, validate, and route an extension. */
export type ExtensionDefinition = {
  readonly id: string;
  readonly execution?: ExecutionMode;
  readonly dependencies?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly create: (context: ExtensionContext) => ExtensionInstance;
};

export type ExtensionState =
  | "registered"
  | "handshaking"
  | "ready"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

export type FailurePhase = "registration" | "start" | "runtime" | "stop";

export type ExtensionSnapshot = {
  id: string;
  source: string;
  execution: ExecutionMode;
  dependencies: readonly string[];
  capabilities: readonly string[];
  state: ExtensionState;
  consumers: number;
  error?: string;
};

export type RuntimeEvent =
  | { type: "candidate_discovered"; source: string }
  | { type: "candidate_invalid"; source: string; error: string }
  | { type: "extension_registered"; extensionId: string; source: string }
  | { type: "extension_handshake"; extensionId: string }
  | { type: "extension_ready"; extensionId: string }
  | {
      type: "extension_manual_lease";
      extensionId: string;
      acquired: boolean;
    }
  | { type: "extension_starting"; extensionId: string }
  | { type: "extension_started"; extensionId: string }
  | { type: "extension_stopping"; extensionId: string }
  | { type: "extension_stopped"; extensionId: string }
  | {
      type: "extension_failed";
      extensionId: string;
      phase: FailurePhase;
      error: string;
    }
  | { type: "extension_event"; event: ExtensionEvent }
  | {
      type: "capability_registered";
      extensionId: string;
      capability: string;
    }
  | {
      type: "capability_unregistered";
      extensionId: string;
      capability: string;
    }
  | {
      type: "extension_log";
      extensionId: string;
      level: LogLevel;
      message: string;
      details?: JsonValue;
    };

export type RuntimeEventListener = (
  event: RuntimeEvent,
) => void | Promise<void>;
