/** A JSON scalar accepted at an extension or runtime boundary. */
export type JsonPrimitive = string | number | boolean | null;

/** A JSON object whose property values are also JSON values. */
export type JsonObject = { [key: string]: JsonValue };

/** A JSON array whose elements are also JSON values. */
export type JsonArray = JsonValue[];

/** Any value that can cross the runtime's JSON-only boundaries. */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** Where an extension instance executes. `child` is the default. */
export type ExecutionMode = "main" | "worker" | "child";

/** Severity used for diagnostics emitted by an extension. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** JSON-safe event emitted by an extension before the runtime adds its source id. */
export type ExtensionEventInput = {
  /** Event name interpreted by the publishing extension and its subscribers. */
  type: string;
  /** Optional feature-specific JSON payload. */
  payload?: JsonValue;
};

/** An extension event after the runtime identifies its publisher. */
export type ExtensionEvent = ExtensionEventInput & {
  /** ID of the extension that published the event. */
  source: string;
};

/** Listener invoked for a matching extension event or the `*` wildcard. */
export type ExtensionEventListener = (
  event: ExtensionEvent,
) => void | Promise<void>;

/** Function that handles one JSON capability payload. */
export type CapabilityHandler = (
  payload: JsonValue,
) => JsonValue | Promise<JsonValue>;

/** Services the extension runtime exposes to a running extension instance. */
export type ExtensionContext = {
  /** ID of the extension receiving this context. */
  readonly extensionId: string;
  /** Publish an event; the runtime adds the extension's source ID. */
  publish(event: ExtensionEventInput): void;
  /** Subscribe to an event type and return a function that removes the listener. */
  subscribe(type: string, listener: ExtensionEventListener): () => void;
  /** Register a capability handler and return a function that removes it. */
  provide(name: string, handler: CapabilityHandler): () => void;
  /** Request another extension's capability through the runtime router. */
  request<TResponse extends JsonValue = JsonValue>(
    capability: string,
    payload: JsonValue,
  ): Promise<TResponse>;
  /** Emit a diagnostic event without affecting capability routing. */
  log(level: LogLevel, message: string, details?: JsonValue): void;
};

/** Lifecycle hooks for one extension instance. */
export type ExtensionInstance = {
  /** Start the instance and register its capabilities. */
  start(): void | Promise<void>;
  /** Stop the instance and release its runtime bindings. */
  stop(): void | Promise<void>;
};

/** Static metadata the runtime uses to discover, validate, and route an extension. */
export type ExtensionDefinition = {
  /** Globally unique ID used by dependencies and lifecycle commands. */
  readonly id: string;
  /** Execution boundary; omitted values run in an isolated child process. */
  readonly execution?: ExecutionMode;
  /** Extension IDs that must be running before this extension starts. */
  readonly dependencies?: readonly string[];
  /** Optional capabilities; a non-empty list restricts registrations. */
  readonly capabilities?: readonly string[];
  /** Create the instance that implements this definition. */
  readonly create: (context: ExtensionContext) => ExtensionInstance;
};

/** Lifecycle state exposed in extension snapshots. */
export type ExtensionState =
  | "registered"
  | "handshaking"
  | "ready"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

/** Runtime phase in which an extension failure occurred. */
export type FailurePhase = "registration" | "start" | "runtime" | "stop";

/** Read-only runtime information for one registered extension. */
export type ExtensionSnapshot = {
  /** Registered extension ID. */
  id: string;
  /** Source file or package path from which the definition was loaded. */
  source: string;
  /** Effective execution mode, including the `child` default. */
  execution: ExecutionMode;
  /** Declared dependency IDs. */
  dependencies: readonly string[];
  /** Declared capability names. */
  capabilities: readonly string[];
  /** Current lifecycle state. */
  state: ExtensionState;
  /** Number of running extensions holding dependency leases on this extension. */
  consumers: number;
  /** Failure message when the extension is in the `failed` state. */
  error?: string;
};

/** Notifications emitted by the runtime to its host observers. */
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

/** Listener for transient runtime notifications. Promise results are not awaited. */
export type RuntimeEventListener = (
  event: RuntimeEvent,
) => void | Promise<void>;
