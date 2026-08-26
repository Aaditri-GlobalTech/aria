import type {
  CoreCommandMap,
  CoreCommandResultMap,
  CoreCommandType,
  DiscoveryReport,
} from "./commands";
import { isCoreCommand } from "./commands";
import {
  type DiscoveredExtension,
  type DiscoveryIssue,
  discoverExtensions,
  type ModuleLoader,
} from "./discovery";
import { CommandDispatcher, EventBus } from "./events";
import {
  type BoundaryOptions,
  createRemoteBoundary,
  type RemoteBoundary,
} from "./execution";
import { CoreEventStore, defaultStoragePath } from "./persistence";
import type {
  CapabilityHandler,
  CoreEvent,
  CoreEventListener,
  ExecutionMode,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionEvent,
  ExtensionEventInput,
  ExtensionInstance,
  ExtensionSnapshot,
  ExtensionState,
  JsonValue,
} from "./types";

export type CoreOptions = {
  /** Explicit module or package sources; an empty list loads no extensions. */
  extensionSources?: readonly string[];
  moduleLoader?: ModuleLoader;
  bootstrapPath?: string;
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** SQLite path; defaults to ~/.aria/host.db. */
  storagePath?: string;
  /** How often selected buffered Core events are flushed to SQLite. */
  persistenceIntervalMs?: number;
  /** Receives transient Core events; listener failures do not stop Core. */
  onEvent?: CoreEventListener;
};

type InternalExtension = {
  definition: ExtensionDefinition;
  source: string;
  state: ExtensionState;
  consumers: number;
  manualLease: boolean;
  error?: string;
  registrationLease: boolean;
  boundary?: RemoteBoundary;
  instance?: ExtensionInstance;
  startPromise?: Promise<void>;
  stopPromise?: Promise<void>;
  dependencyLeases: Set<string>;
  providedCapabilities: Set<string>;
  handlers: Map<string, CapabilityHandler>;
  cleanups: Set<() => void>;
  subscriptions: Set<string>;
};

type DependencyValidation = {
  order: string[];
  failures: Map<string, string>;
};

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function executionMode(definition: ExtensionDefinition): ExecutionMode {
  return definition.execution ?? "child";
}

function listValues(values: readonly string[] | undefined) {
  return [...(values ?? [])];
}

function isInstance(value: unknown): value is ExtensionInstance {
  if (typeof value !== "object" || value === null) return false;
  const instance = value as Record<string, unknown>;
  return (
    typeof instance.start === "function" && typeof instance.stop === "function"
  );
}

export class CoreRuntime {
  readonly events = new EventBus<CoreEvent>();

  private readonly commandDispatcher: CommandDispatcher<
    CoreCommandMap,
    CoreCommandResultMap
  >;
  private readonly extensionSources: readonly string[];
  private readonly moduleLoader?: ModuleLoader;
  private readonly boundaryOptions: BoundaryOptions;
  private readonly storagePath?: string;
  private readonly persistenceIntervalMs: number;
  private readonly extensions = new Map<string, InternalExtension>();
  private eventStore?: CoreEventStore;
  private eventStorePromise?: Promise<CoreEventStore>;
  private readonly extensionEvents = new EventBus<ExtensionEvent>();
  private initialization?: Promise<DiscoveryReport>;
  private shuttingDown = false;

  constructor(options: CoreOptions = {}) {
    this.extensionSources = options.extensionSources ?? [];
    this.moduleLoader = options.moduleLoader;
    this.boundaryOptions = {
      bootstrapPath: options.bootstrapPath,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      requestTimeoutMs: options.requestTimeoutMs,
    };
    this.storagePath = options.storagePath;
    this.persistenceIntervalMs = options.persistenceIntervalMs ?? 1000;
    this.commandDispatcher = new CommandDispatcher<
      CoreCommandMap,
      CoreCommandResultMap
    >({
      initialize: () => this.initializeCommand(),
      start: (command) => this.startCommand(command.extensionId),
      request: (command) =>
        this.requestCommand(command.capability, command.payload),
      stop: (command) => this.stopCommand(command.extensionId),
      shutdown: () => this.shutdownCommand(),
    });
    if (options.onEvent) this.events.on("*", options.onEvent);
  }

  dispatch<Key extends CoreCommandType>(
    command: CoreCommandMap[Key] & { type: Key },
  ): Promise<CoreCommandResultMap[Key]> {
    if (!isCoreCommand(command)) {
      return Promise.reject(new Error("Invalid Core command"));
    }
    return this.commandDispatcher.dispatch(command);
  }

  getExtensions(): ExtensionSnapshot[] {
    return [...this.extensions.values()]
      .sort((a, b) => a.definition.id.localeCompare(b.definition.id))
      .map((extension) => this.snapshot(extension));
  }

  getExtension(id: string): ExtensionSnapshot | undefined {
    const extension = this.extensions.get(id);
    return extension ? this.snapshot(extension) : undefined;
  }

  private async initializeCommand(): Promise<DiscoveryReport> {
    if (this.shuttingDown) throw new Error("Core has been shut down");
    if (!this.initialization) this.initialization = this.initializeOnce();
    return this.initialization;
  }

  private async ensureEventStore(): Promise<CoreEventStore> {
    if (this.eventStore) return this.eventStore;
    if (!this.eventStorePromise) {
      this.eventStorePromise = CoreEventStore.open({
        path: this.storagePath ?? defaultStoragePath(),
        intervalMs: this.persistenceIntervalMs,
        onFlushError: (error) =>
          this.events.emit({
            type: "persistence_failed",
            error: error.message,
          }),
      });
    }
    const opening = this.eventStorePromise;
    try {
      this.eventStore = await opening;
      return this.eventStore;
    } finally {
      if (this.eventStorePromise === opening)
        this.eventStorePromise = undefined;
    }
  }

  private async startCommand(id: string): Promise<undefined> {
    await this.initializeCommand();
    const extension = this.getRequiredExtension(id);
    await this.ensureStarted(extension);
    if (!extension.manualLease) {
      extension.manualLease = true;
      this.emit({
        type: "extension_manual_lease",
        extensionId: id,
        acquired: true,
      });
    }
    return undefined;
  }

  private async requestCommand(
    capability: string,
    payload: JsonValue,
  ): Promise<JsonValue> {
    await this.initializeCommand();
    return this.requestInternal(capability, payload);
  }

  private async stopCommand(id: string): Promise<undefined> {
    await this.initializeCommand();
    const extension = this.getRequiredExtension(id);
    const hadManualLease = extension.manualLease;
    extension.manualLease = false;
    if (hadManualLease) {
      this.emit({
        type: "extension_manual_lease",
        extensionId: id,
        acquired: false,
      });
    }
    await this.stopIfUnused(extension);
    return undefined;
  }

  private async shutdownCommand(): Promise<undefined> {
    if (this.shuttingDown) return undefined;
    this.shuttingDown = true;
    if (this.initialization) await this.initialization.catch(() => undefined);

    try {
      for (const extension of this.extensions.values()) {
        if (!extension.manualLease) continue;
        extension.manualLease = false;
        this.emit({
          type: "extension_manual_lease",
          extensionId: extension.definition.id,
          acquired: false,
        });
      }
      for (const extension of this.extensions.values()) {
        await this.stopIfUnused(extension).catch(() => undefined);
      }
      for (const extension of this.extensions.values()) {
        if (extension.state === "running") {
          await this.stopExtension(extension).catch(() => undefined);
        }
      }
      for (const extension of this.extensions.values()) {
        if (!extension.boundary) continue;
        await extension.boundary.dispose().catch(() => undefined);
        extension.boundary = undefined;
        extension.registrationLease = false;
      }
    } finally {
      this.eventStore?.close();
      this.eventStore = undefined;
    }
    return undefined;
  }

  private async initializeOnce(): Promise<DiscoveryReport> {
    const manualLeases = (await this.ensureEventStore()).getManualLeases();
    const result = await discoverExtensions(this.extensionSources, {
      moduleLoader: this.moduleLoader,
      onCandidate: (source) =>
        this.emit({ type: "candidate_discovered", source }),
    });
    const issues = [...result.issues];
    for (const issue of result.issues) {
      this.emit({
        type: "candidate_invalid",
        source: issue.source,
        error: issue.error,
      });
    }

    this.registerDefinitions(result.definitions, issues);
    for (const extension of this.extensions.values()) {
      extension.manualLease = manualLeases.has(extension.definition.id);
    }
    const validation = this.validateDependencies();
    for (const [id, error] of validation.failures) {
      const extension = this.extensions.get(id);
      if (!extension) continue;
      this.markFailed(extension, "registration", error);
      issues.push({ source: extension.source, error });
    }

    for (const id of validation.order) {
      const extension = this.extensions.get(id);
      if (!extension || extension.state === "failed") continue;
      const failedDependency = listValues(
        extension.definition.dependencies,
      ).find(
        (dependency) => this.extensions.get(dependency)?.state === "failed",
      );
      if (failedDependency) {
        const error = `Dependency is unavailable: ${failedDependency}`;
        this.markFailed(extension, "registration", error);
        issues.push({ source: extension.source, error });
        continue;
      }

      try {
        await this.registerExtension(extension);
      } catch (error) {
        const message = asError(error).message;
        this.markFailed(extension, "registration", message);
        issues.push({ source: extension.source, error: message });
      }
    }

    for (const id of validation.order) {
      const extension = this.extensions.get(id);
      if (!extension?.manualLease || extension.state === "failed") {
        continue;
      }
      try {
        await this.ensureStarted(extension);
      } catch (error) {
        issues.push({
          source: extension.source,
          error: asError(error).message,
        });
      }
    }

    return {
      candidates: result.candidates,
      registered: [...this.extensions.keys()].sort(),
      issues,
    };
  }

  private registerDefinitions(
    definitions: DiscoveredExtension[],
    issues: DiscoveryIssue[],
  ) {
    for (const discovered of definitions) {
      const { definition, source } = discovered;
      if (this.extensions.has(definition.id)) {
        const error = `Duplicate extension id: ${definition.id}`;
        issues.push({ source, error });
        this.emit({ type: "candidate_invalid", source, error });
        continue;
      }

      const extension: InternalExtension = {
        definition,
        source,
        state: "registered",
        consumers: 0,
        manualLease: false,
        registrationLease: false,
        dependencyLeases: new Set(),
        providedCapabilities: new Set(),
        handlers: new Map(),
        cleanups: new Set(),
        subscriptions: new Set(),
      };
      this.extensions.set(definition.id, extension);
      this.emit({
        type: "extension_registered",
        extensionId: definition.id,
        source,
      });
    }
  }

  private validateDependencies(): DependencyValidation {
    const failures = new Map<string, string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const order: string[] = [];

    for (const extension of this.extensions.values()) {
      for (const capability of listValues(extension.definition.capabilities)) {
        const provider = [...this.extensions.values()].find(
          (candidate) =>
            candidate.definition.id !== extension.definition.id &&
            listValues(candidate.definition.capabilities).includes(capability),
        );
        if (provider) {
          const error = `Capability is declared by multiple extensions: ${capability}`;
          failures.set(extension.definition.id, error);
          failures.set(provider.definition.id, error);
        }
      }
    }

    const visit = (id: string, stack: string[]): boolean => {
      if (failures.has(id)) return false;
      if (visiting.has(id)) {
        const cycleStart = stack.indexOf(id);
        for (const cycleId of stack.slice(cycleStart)) {
          failures.set(cycleId, `Dependency cycle includes: ${cycleId}`);
        }
        return false;
      }
      if (visited.has(id)) return true;

      const extension = this.extensions.get(id);
      if (!extension) return false;
      visiting.add(id);
      stack.push(id);
      let valid = true;
      for (const dependency of listValues(extension.definition.dependencies)) {
        if (!this.extensions.has(dependency)) {
          failures.set(id, `Missing dependency: ${dependency}`);
          valid = false;
          continue;
        }
        if (!visit(dependency, stack)) {
          if (!failures.has(id)) {
            failures.set(id, `Dependency is unavailable: ${dependency}`);
          }
          valid = false;
        }
      }
      stack.pop();
      visiting.delete(id);
      visited.add(id);
      if (valid) order.push(id);
      return valid;
    };

    for (const id of [...this.extensions.keys()].sort()) visit(id, []);
    return { order, failures };
  }

  private async registerExtension(extension: InternalExtension) {
    extension.state = "handshaking";
    const mode = executionMode(extension.definition);
    if (mode === "main") {
      this.markReady(extension);
      return;
    }

    const boundary = createRemoteBoundary(
      mode,
      extension.source,
      extension.definition.id,
      {
        onEvent: (event) => this.publishExtensionEvent(extension, event),
        onRequest: (capability, payload) =>
          this.requestInternal(capability, payload, extension.definition.id),
        onSubscription: (eventType, subscribed) =>
          this.updateRemoteSubscription(extension, eventType, subscribed),
        onCapability: (name, registered) =>
          this.updateRemoteCapability(extension, name, registered),
        onLog: (level, message, details) =>
          this.emit({
            type: "extension_log",
            extensionId: extension.definition.id,
            level,
            message,
            details,
          }),
        onFailure: (error) => {
          void this.failExtension(extension, "runtime", error);
        },
      },
      this.boundaryOptions,
    );
    extension.boundary = boundary;
    extension.registrationLease = true;
    try {
      await boundary.load();
      this.markReady(extension);
    } catch (error) {
      await boundary.dispose().catch(() => undefined);
      extension.boundary = undefined;
      extension.registrationLease = false;
      throw error;
    }
  }

  private markReady(extension: InternalExtension) {
    extension.registrationLease = true;
    this.emit({
      type: "extension_handshake",
      extensionId: extension.definition.id,
    });
    extension.state = "ready";
    this.emit({
      type: "extension_ready",
      extensionId: extension.definition.id,
    });
  }

  private async ensureStarted(
    extension: InternalExtension,
    stack: Set<string> = new Set(),
  ): Promise<void> {
    if (stack.has(extension.definition.id)) {
      throw new Error(
        `Runtime dependency cycle includes: ${extension.definition.id}`,
      );
    }
    if (extension.state === "running") return;
    if (extension.state === "failed") {
      throw new Error(
        extension.error ?? `Extension failed: ${extension.definition.id}`,
      );
    }
    if (extension.state === "starting") {
      if (extension.startPromise) return extension.startPromise;
      throw new Error(
        `Extension is already starting: ${extension.definition.id}`,
      );
    }
    if (extension.state !== "ready") {
      throw new Error(`Extension is not ready: ${extension.definition.id}`);
    }

    const nextStack = new Set(stack);
    nextStack.add(extension.definition.id);
    const startPromise = this.startExtension(extension, nextStack);
    extension.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (extension.startPromise === startPromise)
        extension.startPromise = undefined;
    }
  }

  private async startExtension(
    extension: InternalExtension,
    stack: Set<string>,
  ) {
    extension.state = "starting";
    this.emit({
      type: "extension_starting",
      extensionId: extension.definition.id,
    });
    const acquired: InternalExtension[] = [];

    try {
      for (const dependencyId of listValues(
        extension.definition.dependencies,
      )) {
        const dependency = this.getRequiredExtension(dependencyId);
        await this.ensureStarted(dependency, stack);
        dependency.consumers += 1;
        extension.dependencyLeases.add(dependencyId);
        acquired.push(dependency);
      }

      if (executionMode(extension.definition) === "main") {
        const instance = extension.definition.create(
          this.createContext(extension),
        );
        if (!isInstance(instance)) {
          throw new Error(
            `Extension instance is invalid: ${extension.definition.id}`,
          );
        }
        extension.instance = instance;
        await instance.start();
      } else {
        await extension.boundary?.start();
      }
      if (extension.error) throw new Error(extension.error);

      extension.state = "running";
      this.emit({
        type: "extension_started",
        extensionId: extension.definition.id,
      });
    } catch (error) {
      for (const dependency of acquired.reverse()) {
        await this.releaseDependency(dependency);
      }
      extension.dependencyLeases.clear();
      await this.failExtension(extension, "start", error);
      throw asError(error);
    }
  }

  private async stopExtension(extension: InternalExtension) {
    if (extension.stopPromise) return extension.stopPromise;
    if (extension.state === "starting" && extension.startPromise) {
      await extension.startPromise.catch(() => undefined);
    }
    if (extension.state !== "running") return;

    const stopPromise = this.stopExtensionOnce(extension);
    extension.stopPromise = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (extension.stopPromise === stopPromise)
        extension.stopPromise = undefined;
    }
  }

  private async stopExtensionOnce(extension: InternalExtension) {
    extension.state = "stopping";
    this.emit({
      type: "extension_stopping",
      extensionId: extension.definition.id,
    });
    try {
      if (executionMode(extension.definition) === "main") {
        await extension.instance?.stop();
      } else {
        await extension.boundary?.stop();
      }
      extension.instance = undefined;
      this.clearBindings(extension);
      extension.state = "ready";
      this.emit({
        type: "extension_stopped",
        extensionId: extension.definition.id,
      });

      const dependencies = [...extension.dependencyLeases];
      extension.dependencyLeases.clear();
      for (const dependencyId of dependencies) {
        const dependency = this.extensions.get(dependencyId);
        if (dependency) await this.releaseDependency(dependency);
      }
    } catch (error) {
      await this.failExtension(extension, "stop", error);
      throw asError(error);
    }
  }

  private async releaseDependency(dependency: InternalExtension) {
    dependency.consumers = Math.max(0, dependency.consumers - 1);
    await this.stopIfUnused(dependency);
  }

  private async stopIfUnused(extension: InternalExtension) {
    if (extension.consumers === 0 && !extension.manualLease) {
      await this.stopExtension(extension);
    }
  }

  private async failExtension(
    extension: InternalExtension,
    phase: "registration" | "start" | "runtime" | "stop",
    error: unknown,
  ) {
    if (extension.state === "failed") return;
    const message = asError(error).message;
    const wasRunning =
      extension.state === "running" || extension.state === "starting";
    extension.state = "failed";
    extension.error = message;
    this.emit({
      type: "extension_failed",
      extensionId: extension.definition.id,
      phase,
      error: message,
    });

    if (wasRunning && executionMode(extension.definition) === "main") {
      try {
        await extension.instance?.stop();
      } catch {
        // The extension is already being marked failed.
      }
    }
    extension.instance = undefined;
    this.clearBindings(extension);

    const dependencies = [...extension.dependencyLeases];
    extension.dependencyLeases.clear();
    for (const dependencyId of dependencies) {
      const dependency = this.extensions.get(dependencyId);
      if (dependency) await this.releaseDependency(dependency);
    }

    if (extension.boundary) {
      await extension.boundary.dispose().catch(() => undefined);
      extension.boundary = undefined;
      extension.registrationLease = false;
    }

    const dependentPhase =
      phase === "registration" ? "registration" : "runtime";
    for (const dependent of this.extensions.values()) {
      if (
        dependent.definition.dependencies?.includes(extension.definition.id)
      ) {
        await this.failExtension(
          dependent,
          dependentPhase,
          `Dependency failed: ${extension.definition.id}`,
        );
      }
    }
  }

  private markFailed(
    extension: InternalExtension,
    phase: "registration" | "start" | "runtime" | "stop",
    error: string,
  ) {
    if (extension.state === "failed") return;
    extension.state = "failed";
    extension.error = error;
    this.emit({
      type: "extension_failed",
      extensionId: extension.definition.id,
      phase,
      error,
    });
  }

  private createContext(extension: InternalExtension): ExtensionContext {
    const context: ExtensionContext = {
      extensionId: extension.definition.id,
      publish: (event) => this.publishExtensionEvent(extension, event),
      subscribe: (type, listener) => {
        const unsubscribe = this.extensionEvents.on(type, listener);
        extension.subscriptions.add(type);
        const cleanup = () => {
          unsubscribe();
          extension.subscriptions.delete(type);
          extension.cleanups.delete(cleanup);
        };
        extension.cleanups.add(cleanup);
        return cleanup;
      },
      provide: (name, handler) => {
        this.registerLocalCapability(extension, name, handler);
        const cleanup = () => {
          this.unregisterLocalCapability(extension, name, handler);
          extension.cleanups.delete(cleanup);
        };
        extension.cleanups.add(cleanup);
        return cleanup;
      },
      request: <TResponse extends JsonValue = JsonValue>(
        capability: string,
        payload: JsonValue,
      ) =>
        this.requestInternal(
          capability,
          payload,
          extension.definition.id,
          new Set([extension.definition.id]),
        ) as Promise<TResponse>,
      log: (level, message, details) =>
        this.emit({
          type: "extension_log",
          extensionId: extension.definition.id,
          level,
          message,
          details,
        }),
    };
    return context;
  }

  private registerLocalCapability(
    extension: InternalExtension,
    name: string,
    handler: CapabilityHandler,
  ) {
    if (
      extension.definition.capabilities?.length &&
      !extension.definition.capabilities.includes(name)
    ) {
      throw new Error(`Capability was not declared: ${name}`);
    }
    if (extension.handlers.has(name)) {
      throw new Error(`Capability is already provided: ${name}`);
    }
    const other = this.findActiveProvider(name, extension.definition.id);
    if (other) throw new Error(`Capability is already provided: ${name}`);
    extension.handlers.set(name, handler);
    extension.providedCapabilities.add(name);
    this.emit({
      type: "capability_registered",
      extensionId: extension.definition.id,
      capability: name,
    });
  }

  private unregisterLocalCapability(
    extension: InternalExtension,
    name: string,
    handler: CapabilityHandler,
  ) {
    if (extension.handlers.get(name) !== handler) return;
    extension.handlers.delete(name);
    extension.providedCapabilities.delete(name);
    this.emit({
      type: "capability_unregistered",
      extensionId: extension.definition.id,
      capability: name,
    });
  }

  private updateRemoteCapability(
    extension: InternalExtension,
    name: string,
    registered: boolean,
  ) {
    if (!registered) {
      if (!extension.providedCapabilities.delete(name)) return;
      this.emit({
        type: "capability_unregistered",
        extensionId: extension.definition.id,
        capability: name,
      });
      return;
    }
    if (
      extension.definition.capabilities?.length &&
      !extension.definition.capabilities.includes(name)
    ) {
      void this.failExtension(
        extension,
        "start",
        new Error(`Capability was not declared: ${name}`),
      );
      return;
    }
    const other = this.findActiveProvider(name, extension.definition.id);
    if (other) {
      void this.failExtension(
        extension,
        "start",
        new Error(`Capability is already provided: ${name}`),
      );
      return;
    }
    extension.providedCapabilities.add(name);
    this.emit({
      type: "capability_registered",
      extensionId: extension.definition.id,
      capability: name,
    });
  }

  private updateRemoteSubscription(
    extension: InternalExtension,
    eventType: string,
    subscribed: boolean,
  ) {
    if (subscribed) extension.subscriptions.add(eventType);
    else extension.subscriptions.delete(eventType);
  }

  private clearBindings(extension: InternalExtension) {
    for (const cleanup of [...extension.cleanups]) cleanup();
    extension.cleanups.clear();
    extension.handlers.clear();
    for (const capability of [...extension.providedCapabilities]) {
      extension.providedCapabilities.delete(capability);
      this.emit({
        type: "capability_unregistered",
        extensionId: extension.definition.id,
        capability,
      });
    }
    extension.subscriptions.clear();
  }

  private publishExtensionEvent(
    sourceExtension: InternalExtension,
    event: ExtensionEventInput | ExtensionEvent,
  ) {
    const eventWithSource: ExtensionEvent = {
      type: event.type,
      source: sourceExtension.definition.id,
      ...(event.payload === undefined ? {} : { payload: event.payload }),
    };
    this.emit({ type: "extension_event", event: eventWithSource });
    this.extensionEvents.emit(eventWithSource);

    for (const extension of this.extensions.values()) {
      if (!extension.boundary || extension.state === "failed") continue;
      if (
        extension.subscriptions.has(eventWithSource.type) ||
        extension.subscriptions.has("*")
      ) {
        extension.boundary.deliver(eventWithSource);
      }
    }
  }

  private async requestInternal(
    capability: string,
    payload: JsonValue,
    requesterId?: string,
    stack: Set<string> = new Set(),
  ): Promise<JsonValue> {
    const provider = this.findProvider(capability);
    if (!provider)
      throw new Error(`Capability is not available: ${capability}`);
    if (requesterId && provider.definition.id === requesterId) {
      throw new Error(`Capability request cycle includes: ${requesterId}`);
    }
    await this.ensureStarted(provider, stack);

    if (executionMode(provider.definition) === "main") {
      const handler = provider.handlers.get(capability);
      if (!handler)
        throw new Error(`Capability is not provided: ${capability}`);
      return await handler(payload);
    }
    if (!provider.boundary)
      throw new Error(
        `Extension boundary is unavailable: ${provider.definition.id}`,
      );
    return provider.boundary.invoke(capability, payload);
  }

  private findProvider(capability: string) {
    const declared = [...this.extensions.values()].filter(
      (extension) =>
        extension.state !== "failed" &&
        listValues(extension.definition.capabilities).includes(capability),
    );
    if (declared.length > 1) {
      throw new Error(
        `Capability is provided by multiple extensions: ${capability}`,
      );
    }
    if (declared[0]) return declared[0];
    return this.findActiveProvider(capability);
  }

  private findActiveProvider(capability: string, excludeId?: string) {
    const providers = [...this.extensions.values()].filter(
      (extension) =>
        extension.definition.id !== excludeId &&
        extension.state !== "failed" &&
        extension.providedCapabilities.has(capability),
    );
    if (providers.length > 1) {
      throw new Error(
        `Capability is provided by multiple extensions: ${capability}`,
      );
    }
    return providers[0];
  }

  private getRequiredExtension(id: string) {
    const extension = this.extensions.get(id);
    if (!extension) throw new Error(`Extension was not found: ${id}`);
    return extension;
  }

  private snapshot(extension: InternalExtension): ExtensionSnapshot {
    return {
      id: extension.definition.id,
      source: extension.source,
      execution: executionMode(extension.definition),
      dependencies: listValues(extension.definition.dependencies),
      capabilities: listValues(extension.definition.capabilities),
      state: extension.state,
      consumers: extension.consumers,
      ...(extension.error ? { error: extension.error } : {}),
    };
  }

  private emit(event: CoreEvent) {
    try {
      this.eventStore?.append(event);
    } catch (error) {
      this.events.emit({
        type: "persistence_failed",
        error: asError(error).message,
      });
    }
    this.events.emit(event);
  }
}

export function createCore(options?: CoreOptions) {
  return new CoreRuntime(options);
}
