type EventListener<Event> = (event: Event) => void | Promise<void>;

type EventWithType = {
  type: string;
};

/** Emits transient notifications; async listeners are not awaited by emit. */
export class EventBus<Event extends EventWithType> {
  private readonly listeners = new Map<string, Set<EventListener<Event>>>();

  /** Subscribe to one event type or to every event with `*`. */
  on(type: Event["type"] | "*", listener: EventListener<Event>): () => void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(type);
    };
  }

  /** Emit to a snapshot of listeners; listener failures are isolated. */
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
