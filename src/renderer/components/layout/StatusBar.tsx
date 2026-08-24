import { For, Show } from "solid-js";
import type { AgentSession } from "../../../shared/agent";

export type StatusBarProps = {
  waitingSessions: AgentSession[];
  onSelectSession: (id: string) => void;
};

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
