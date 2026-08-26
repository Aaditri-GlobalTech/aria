import { normalizeExtensionExport, resolveModuleEntry } from "./discovery";
import { createJsonLineReader } from "./json-lines";
import { isWireMessage, type WireMessage } from "./messages";
import type {
  CapabilityHandler,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionEvent,
  ExtensionEventInput,
  ExtensionEventListener,
  ExtensionInstance,
  JsonValue,
  LogLevel,
} from "./types";

type WorkerTransport = {
  postMessage(message: WireMessage): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
};

type PendingRequest = {
  resolve: (value: JsonValue | undefined) => void;
  reject: (error: Error) => void;
};

type RegisteredHandler = {
  handler: CapabilityHandler;
};

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

const workerTransport =
  Bun.argv.at(-1) === "--aria-worker"
    ? (globalThis as unknown as WorkerTransport)
    : undefined;
const transportArguments = workerTransport
  ? Bun.argv.slice(-3, -1)
  : Bun.argv.slice(-2);
const entryPath = transportArguments[0];
const extensionId = transportArguments[1];

async function fatal(error: unknown): Promise<never> {
  await Bun.stderr.write(`${asError(error).message}\n`);
  process.exit(1);
}

if (!entryPath || !extensionId)
  await fatal("Extension bootstrap arguments are missing");

let definition: ExtensionDefinition;
try {
  const entry = await resolveModuleEntry(entryPath);
  const loaded = await import(Bun.pathToFileURL(entry).href);
  const normalized = normalizeExtensionExport(loaded, entryPath);
  const selected = normalized.definitions.find(
    (candidate) => candidate.definition.id === extensionId,
  )?.definition;
  if (!selected) {
    throw new Error(`Extension definition was not found: ${extensionId}`);
  }
  definition = selected;
} catch (error) {
  await fatal(error);
}

let outputTail = Promise.resolve();
function send(message: WireMessage) {
  if (workerTransport) {
    workerTransport.postMessage(message);
    return;
  }
  outputTail = outputTail
    .then(() => Bun.stdout.write(`${JSON.stringify(message)}\n`))
    .then(() => undefined)
    .catch(() => undefined);
}

function closeTransport() {
  if (workerTransport) {
    workerTransport.close();
    return;
  }
  void outputTail.then(() => process.exit(0));
}

const pendingRequests = new Map<string, PendingRequest>();
const handlers = new Map<string, RegisteredHandler>();
const listeners = new Map<string, Set<ExtensionEventListener>>();
let instance: ExtensionInstance | undefined;

function clearBindings() {
  for (const name of handlers.keys()) {
    send({ type: "capability_unregister", name });
  }
  handlers.clear();

  for (const eventType of listeners.keys()) {
    send({ type: "unsubscribe", eventType });
  }
  listeners.clear();
}

function context(): ExtensionContext {
  return {
    extensionId,
    publish(event: ExtensionEventInput) {
      send({
        type: "event",
        event: { ...event, source: extensionId },
      });
    },
    subscribe(type: string, listener: ExtensionEventListener) {
      const eventListeners = listeners.get(type) ?? new Set();
      const wasEmpty = eventListeners.size === 0;
      eventListeners.add(listener);
      listeners.set(type, eventListeners);
      if (wasEmpty) send({ type: "subscribe", eventType: type });

      return () => {
        eventListeners.delete(listener);
        if (eventListeners.size > 0) return;
        listeners.delete(type);
        send({ type: "unsubscribe", eventType: type });
      };
    },
    provide(name: string, handler: CapabilityHandler) {
      if (handlers.has(name)) {
        throw new Error(`Capability is already provided: ${name}`);
      }
      const registered = { handler };
      handlers.set(name, registered);
      send({ type: "capability_register", name });

      return () => {
        if (handlers.get(name) !== registered) return;
        handlers.delete(name);
        send({ type: "capability_unregister", name });
      };
    },
    request<TResponse extends JsonValue = JsonValue>(
      capability: string,
      payload: JsonValue,
    ) {
      const id = crypto.randomUUID();
      const request = new Promise<JsonValue | undefined>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        send({ type: "request", id, capability, payload });
      });
      return request.then((value) => value as TResponse);
    },
    log(level: LogLevel, message: string, details?: JsonValue) {
      send({ type: "log", level, message, details });
    },
  };
}

async function startInstance() {
  if (instance) return;
  const created = definition.create(context());
  instance = created;
  try {
    await created.start();
  } catch (error) {
    instance = undefined;
    clearBindings();
    throw error;
  }
}

async function stopInstance() {
  if (!instance) return;
  const current = instance;
  await current.stop();
  instance = undefined;
  clearBindings();
}

function respond(id: string, value?: JsonValue) {
  send(
    value === undefined
      ? { type: "response", id, success: true }
      : { type: "response", id, success: true, value },
  );
}

function respondError(id: string, error: unknown) {
  send({
    type: "response",
    id,
    success: false,
    error: asError(error).message,
  });
}

function dispatchEvent(event: ExtensionEvent) {
  const eventListeners = new Set([
    ...(listeners.get(event.type) ?? []),
    ...(listeners.get("*") ?? []),
  ]);
  for (const listener of eventListeners) {
    try {
      void Promise.resolve(listener(event)).catch((error: unknown) => {
        send({
          type: "log",
          level: "error",
          message: asError(error).message,
        });
      });
    } catch (error) {
      send({
        type: "log",
        level: "error",
        message: asError(error).message,
      });
    }
  }
}

async function handleMessage(message: WireMessage) {
  if (message.type === "response") {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    if (message.success) pending.resolve(message.value);
    else pending.reject(new Error(message.error));
    return;
  }

  if (message.type === "event") {
    dispatchEvent(message.event);
    return;
  }

  if (message.type === "command") {
    try {
      if (message.command === "start") await startInstance();
      if (message.command === "stop") await stopInstance();
      if (message.command === "shutdown") {
        await stopInstance();
        respond(message.id);
        closeTransport();
        return;
      }
      respond(message.id);
    } catch (error) {
      respondError(message.id, error);
    }
    return;
  }

  if (message.type === "invoke") {
    try {
      const registered = handlers.get(message.capability);
      if (!registered) {
        throw new Error(`Capability is not provided: ${message.capability}`);
      }
      respond(message.id, await registered.handler(message.payload));
    } catch (error) {
      respondError(message.id, error);
    }
  }
}

function receive(value: unknown) {
  if (!isWireMessage(value)) {
    send({ type: "log", level: "error", message: "Invalid boundary message" });
    return;
  }
  void handleMessage(value);
}

send({
  type: "hello",
  protocolVersion: 1,
  extensionId,
});

if (workerTransport) {
  workerTransport.onmessage = (event) => receive(event.data);
} else {
  const reader = createJsonLineReader((line) => {
    try {
      receive(JSON.parse(line) as unknown);
    } catch (error) {
      send({ type: "log", level: "error", message: asError(error).message });
    }
  });
  const inputReader = Bun.stdin.stream().getReader();
  void (async () => {
    try {
      while (true) {
        const result = await inputReader.read();
        if (result.done) break;
        reader.push(result.value);
      }
    } catch (error) {
      send({ type: "log", level: "error", message: asError(error).message });
    } finally {
      inputReader.releaseLock();
      reader.end();
      closeTransport();
    }
  })();
}
