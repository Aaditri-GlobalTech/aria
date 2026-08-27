import type { AgentSession } from "@aria/extension-agent";
import { For, Show } from "solid-js";

/** Inputs for the session list and workspace groups. */
export type SessionSidebarProps = {
  sessions: AgentSession[];
  openTabIds: string[];
  onOpen: (id: string) => void;
  onNew: () => void;
  selectedSessionId?: string;
  workspaceCwd?: string;
};

function statusText(session: AgentSession) {
  if (session.status === "waiting") return "Waiting";
  if (session.status === "running") return "Working";
  if (session.status === "starting") return "Starting";
  if (session.status === "error") return "Error";
  return session.active ? "Ready" : "Idle";
}

/** Group sessions by workspace and put the selected workspace first. */
export function groupSessions(
  sessions: AgentSession[],
  selectedWorkspace?: string,
  selectedSessionId?: string,
): Array<[string, AgentSession[]]> {
  const grouped = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    const group = grouped.get(session.cwd) ?? [];
    group.push(session);
    grouped.set(session.cwd, group);
  }

  if (selectedWorkspace && !grouped.has(selectedWorkspace)) {
    grouped.set(selectedWorkspace, []);
  }

  const groups = [...grouped.entries()].map(
    ([cwd, group]): [string, AgentSession[]] => [
      cwd,
      group.sort((a, b) => {
        const priority = (session: AgentSession) =>
          session.id === selectedSessionId ? 0 : session.active ? 1 : 2;
        return (
          priority(a) - priority(b) ||
          (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "")
        );
      }),
    ],
  );
  const selectedIndex = groups.findIndex(([cwd]) => cwd === selectedWorkspace);
  if (selectedIndex > 0) {
    const [selected] = groups.splice(selectedIndex, 1);
    if (selected) groups.unshift(selected);
  }
  return groups;
}

type SessionGroupProps = {
  cwd: string;
  sessions: AgentSession[];
  selected: boolean;
  openTabIds: string[];
  onOpen: (id: string) => void;
};

function SessionGroup(props: SessionGroupProps) {
  return (
    <details class="session-cwd-group" open={props.selected}>
      <summary title={props.cwd}>
        <span class="codicon codicon-chevron-down" aria-hidden="true" />
        <span class="session-cwd-name">
          {props.cwd.split(/[\\/]/).filter(Boolean).pop() ?? props.cwd}
        </span>
        <span class="session-cwd-count">{props.sessions.length}</span>
      </summary>
      <div class="session-cwd-items">
        <Show
          when={props.sessions.length > 0}
          fallback={<p class="session-group-empty">No sessions</p>}
        >
          <For each={props.sessions}>
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
                      <span class="session-entry-feedback">feedback</span>
                    </Show>
                  </span>
                </span>
                <Show when={session.unread}>
                  <span class="session-entry-unread" aria-hidden="true" />
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
    </details>
  );
}

/** Render workspace-grouped Agent sessions and the new-session action. */
export function SessionSidebar(props: SessionSidebarProps) {
  const groups = () =>
    groupSessions(props.sessions, props.workspaceCwd, props.selectedSessionId);
  const selectedGroups = () =>
    groups().filter(([cwd]) => cwd === props.workspaceCwd);
  const otherGroups = () =>
    groups().filter(([cwd]) => cwd !== props.workspaceCwd);

  return (
    <div class="session-sidebar">
      <div class="session-sidebar-heading panel-heading">
        <h1>Sessions</h1>
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

      <Show
        when={groups().length > 0}
        fallback={
          <p class="session-list-empty">
            No sessions yet. Open a workspace to start one.
          </p>
        }
      >
        <div class="session-list">
          <div class="session-selected-workspace">
            <For each={selectedGroups()}>
              {(group) => (
                <SessionGroup
                  cwd={group[0]}
                  sessions={group[1]}
                  selected
                  openTabIds={props.openTabIds}
                  onOpen={props.onOpen}
                />
              )}
            </For>
          </div>
          <div class="session-other-workspaces">
            <For each={otherGroups()}>
              {(group) => (
                <SessionGroup
                  cwd={group[0]}
                  sessions={group[1]}
                  selected={false}
                  openTabIds={props.openTabIds}
                  onOpen={props.onOpen}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
