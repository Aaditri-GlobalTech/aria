type EventListener<Event> = (event: Event) => void | Promise<void>;

type EventWithType = {
  type: string;
};

type CommandMap = Record<string, { type: string }>;
type CommandResults<Commands extends CommandMap> = {
  [Key in keyof Commands]: unknown;
};
type CommandHandler<Command, Result> = (
  command: Command,
) => Result | Promise<Result>;
type CommandHandlers<
  Commands extends CommandMap,
  Results extends CommandResults<Commands>,
> = {
  [Key in keyof Commands]: CommandHandler<Commands[Key], Results[Key]>;
};

/** Emits transient notifications; async listeners are not awaited by emit. */
export class EventBus<Event extends EventWithType> {
  private readonly listeners = new Map<string, Set<EventListener<Event>>>();

  on(type: Event["type"] | "*", listener: EventListener<Event>): () => void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(type);
    };
  }

  emit(event: Event): void {
    const listeners = new Set([
      ...(this.listeners.get(event.type) ?? []),
      ...(this.listeners.get("*") ?? []),
    ]);

    for (const listener of listeners) {
      try {
        void Promise.resolve(listener(event)).catch(() => undefined);
      } catch {
        // Observers must not break the runtime that emitted the event.
      }
    }
  }
}

/** Dispatches discriminated commands to typed handlers. */
export class CommandDispatcher<
  Commands extends CommandMap,
  Results extends CommandResults<Commands>,
> {
  private readonly handlers: CommandHandlers<Commands, Results>;

  constructor(handlers: CommandHandlers<Commands, Results>) {
    this.handlers = handlers;
  }

  dispatch<Key extends keyof Commands>(
    command: Commands[Key],
  ): Promise<Results[Key]> {
    const handler = this.handlers[command.type as Key];
    if (!handler) {
      return Promise.reject(
        new Error(`Command is not registered: ${String(command.type)}`),
      );
    }
    try {
      return Promise.resolve(handler(command as Commands[Key])) as Promise<
        Results[Key]
      >;
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
