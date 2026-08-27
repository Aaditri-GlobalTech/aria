import type { AgentSession } from "@aria/extension-agent";
import { For, Show } from "solid-js";

/** Status-bar shortcuts for sessions that are waiting on user input. */
export type StatusBarProps = {
  waitingSessions: AgentSession[];
  onSelectSession: (id: string) => void;
};

/** Render shortcuts for sessions waiting on feedback. */
export function StatusBar(props: StatusBarProps) {
  return (
    <footer class="status-bar">
      <div class="status-bar-right">
        <For each={props.waitingSessions}>
          {(session) => (
            <button
              class="status-bar-notification"
              type="button"
              on:click={() => props.onSelectSession(session.id)}
              title={`Feedback needed: ${session.name ?? session.title}`}
            >
              <span
                class="codicon codicon-comment-discussion"
                aria-hidden="true"
              />
              <span class="status-bar-notification-label">
                {session.name ?? session.title}
              </span>
            </button>
          )}
        </For>
        <Show when={props.waitingSessions.length === 0}>
          <span class="status-bar-idle">Aria</span>
        </Show>
      </div>
    </footer>
  );
}
