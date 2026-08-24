import { For, Show } from "solid-js";
import type { AgentSession } from "../../../shared/agent";

export type SessionSidebarProps = {
  sessions: AgentSession[];
  openTabIds: string[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onPickWorkspace: () => void;
};

function cwdName(cwd: string) {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

function statusText(session: AgentSession) {
  if (session.status === "waiting") return "Waiting";
  if (session.status === "running") return "Working";
  if (session.status === "starting") return "Starting";
  if (session.status === "error") return "Error";
  return session.active ? "Ready" : "Idle";
}

export function SessionSidebar(props: SessionSidebarProps) {
  const groups = () => {
    // Group by absolute workspace path while sorting the newest session first.
    const grouped = new Map<string, AgentSession[]>();
    for (const session of props.sessions) {
      const group = grouped.get(session.cwd) ?? [];
      group.push(session);
      grouped.set(
        session.cwd,
        group.sort((a, b) =>
          (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
        ),
      );
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  };

  return (
    <div class="session-sidebar">
      <div class="session-sidebar-heading panel-heading">
        <h1>Sessions</h1>
        <button
          class="session-sidebar-action"
          type="button"
          aria-label="Open workspace for new session"
          title="New session in workspace"
          on:click={props.onPickWorkspace}
        >
          <span class="codicon codicon-folder-opened" aria-hidden="true" />
        </button>
        <button
          class="session-sidebar-action"
          type="button"
          aria-label="New session"
          title="New session in current workspace"
          on:click={props.onNew}
        >
          <span class="codicon codicon-add" aria-hidden="true" />
        </button>
      </div>

      <div class="session-list">
        <Show
          when={props.sessions.length > 0}
          fallback={
            <p class="session-list-empty">
              No sessions yet. Open a workspace to start one.
            </p>
          }
        >
          <For each={groups()}>
            {([cwd, sessions]) => (
              <details class="session-cwd-group" open>
                <summary title={cwd}>
                  <span
                    class="codicon codicon-chevron-down"
                    aria-hidden="true"
                  />
                  <span class="session-cwd-name">{cwdName(cwd)}</span>
                  <span class="session-cwd-count">{sessions.length}</span>
                </summary>
                <div class="session-cwd-items">
                  <For each={sessions}>
                    {(session) => (
                      <button
                        class={`session-entry ${props.openTabIds.includes(session.id) ? "is-open" : ""}`}
                        type="button"
                        on:click={() => props.onOpen(session.id)}
                        title={`${session.title}\n${session.cwd}`}
                      >
                        <span
                          class={`agent-status-dot agent-status-dot-${session.status}`}
                        />
                        <span class="session-entry-content">
                          <span class="session-entry-title">
                            {session.name ?? session.title}
                          </span>
                          <span class="session-entry-meta">
                            {statusText(session)}
                            <Show when={session.waiting}>
                              <span class="session-entry-feedback">
                                feedback
                              </span>
                            </Show>
                          </span>
                        </span>
                        <Show when={session.unread}>
                          <span
                            class="session-entry-unread"
                            aria-hidden="true"
                          />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </details>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
