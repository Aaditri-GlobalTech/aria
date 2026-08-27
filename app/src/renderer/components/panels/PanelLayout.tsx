/** Coordinates session data, renderer state, and the surrounding workbench panels. */

import type {
  AgentChatItem,
  AgentCommand,
  AgentEvent,
  AgentFeedbackResponse,
  AgentManagerEvent,
  AgentSession,
  AgentStreamingBehavior,
} from "@aria/extension-agent";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { api } from "../../api";
import { useResizablePanels } from "../../hooks/useResizablePanels";
import { ActivityBar, type ActivityView } from "../layout/ActivityBar";
import { MenuBar } from "../layout/MenuBar";
import { StatusBar } from "../layout/StatusBar";
import { AgentView } from "./AgentView";
import {
  applySessionEvent,
  createSessionClientState,
  type SessionClientState,
} from "./agent-session-state";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { PanelHeader } from "./PanelHeader";
import { PanelResizer } from "./PanelResizer";
import { SessionSidebar } from "./SessionSidebar";
import { SourceControlSidebar } from "./SourceControlSidebar";

// The primary sidebar hosts the currently selected Activity Bar view.
const OPENED_WORKSPACES_KEY = "aria.openedWorkspaces";

function readOpenedWorkspaces(): string[] {
  try {
    const value: unknown = JSON.parse(
      globalThis.localStorage.getItem(OPENED_WORKSPACES_KEY) ?? "null",
    );
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (workspace): workspace is string =>
                typeof workspace === "string" && workspace.length > 0,
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

function writeOpenedWorkspaces(workspaces: string[]) {
  try {
    globalThis.localStorage.setItem(
      OPENED_WORKSPACES_KEY,
      JSON.stringify(workspaces),
    );
  } catch {
    // Storage can be unavailable in restricted renderer contexts.
  }
}

/** Preserve event order while coalescing streamed events and history chunks. */
type PendingStateUpdate =
  | { kind: "event"; event: AgentEvent }
  | { kind: "history"; items: AgentChatItem[] };

const activityLabels: Record<ActivityView, string> = {
  explorer: "EXPLORER",
  search: "SEARCH",
  "source-control": "SOURCE CONTROL",
  "run-and-debug": "RUN AND DEBUG",
  extensions: "EXTENSIONS",
  accounts: "ACCOUNTS",
  manage: "MANAGE",
};

/** Compose the desktop workbench and coordinate its feature adapters. */
export function PanelLayout() {
  const panels = useResizablePanels();
  const [activityView, setActivityView] =
    createSignal<ActivityView>("explorer");
  const [sessions, setSessions] = createSignal<AgentSession[]>([]);
  const [tabs, setTabs] = createSignal<string[]>([]);
  const [selectedId, setSelectedId] = createSignal<string>();
  const initialWorkspaces = readOpenedWorkspaces();
  const [workspaces, setWorkspaces] = createSignal(initialWorkspaces);
  const [selectedWorkspace, setSelectedWorkspace] = createSignal(
    initialWorkspaces.at(-1),
  );
  const [states, setStates] = createSignal<Record<string, SessionClientState>>(
    {},
  );
  const pendingStateEvents = new Map<string, PendingStateUpdate[]>();
  let stateFlushScheduled = false;
  let stateFrame: number | undefined;

  const flushStateEvents = () => {
    stateFlushScheduled = false;
    stateFrame = undefined;
    if (pendingStateEvents.size === 0) return;

    const pending = new Map(pendingStateEvents);
    pendingStateEvents.clear();
    // History arrives in small chunks; apply each session's batch once per frame.
    setStates((current) => {
      const next = { ...current };
      for (const [id, updates] of pending) {
        let state = next[id] ?? createSessionClientState();
        let history: AgentChatItem[] = [];
        const flushHistory = () => {
          if (history.length === 0) return;
          state = { ...state, messages: [...state.messages, ...history] };
          history = [];
        };

        for (const update of updates) {
          if (update.kind === "history") {
            history.push(...update.items);
            continue;
          }
          flushHistory();
          state = applySessionEvent(state, update.event);
        }
        flushHistory();
        next[id] = state;
      }
      return next;
    });
  };

  const scheduleStateFlush = () => {
    if (stateFlushScheduled) return;

    stateFlushScheduled = true;
    if (typeof requestAnimationFrame === "function") {
      stateFrame = requestAnimationFrame(flushStateEvents);
    } else {
      queueMicrotask(flushStateEvents);
    }
  };

  const queueStateEvent = (id: string, event: AgentEvent) => {
    const updates = pendingStateEvents.get(id) ?? [];
    updates.push({ kind: "event", event });
    pendingStateEvents.set(id, updates);
    scheduleStateFlush();
  };

  const queueHistory = (id: string, items: AgentChatItem[]) => {
    const updates = pendingStateEvents.get(id) ?? [];
    updates.push({ kind: "history", items });
    pendingStateEvents.set(id, updates);
    scheduleStateFlush();
  };

  const selectedSession = createMemo(() =>
    sessions().find((session) => session.id === selectedId()),
  );
  const rememberWorkspace = (cwd: string) => {
    if (!cwd) return;
    setWorkspaces((current) => {
      if (current.includes(cwd)) return current;
      const next = [...current, cwd];
      writeOpenedWorkspaces(next);
      return next;
    });
  };
  const selectWorkspace = (cwd: string) => {
    if (!cwd) return;
    rememberWorkspace(cwd);
    setSelectedWorkspace(cwd);
  };
  // Explorer and Source Control have their own workspace selection, independent of the open session.
  const workspaceCwd = createMemo(
    () => selectedWorkspace() ?? workspaces()[0] ?? sessions()[0]?.cwd,
  );
  const selectedState = createMemo(() => {
    const id = selectedId();
    return id ? states()[id] : undefined;
  });
  const tabSessions = createMemo(() =>
    tabs()
      .map((id) => sessions().find((session) => session.id === id))
      .filter((session): session is AgentSession => session !== undefined),
  );

  const reportError = (error: unknown) => {
    console.error(error);
  };

  const ensureState = (id: string) => {
    setStates((current) =>
      current[id] ? current : { ...current, [id]: createSessionClientState() },
    );
  };

  const updateState = (
    id: string,
    update: (state: SessionClientState) => SessionClientState,
  ) => {
    setStates((current) => {
      const state = current[id] ?? createSessionClientState();
      return { ...current, [id]: update(state) };
    });
  };

  const updateSession = (session: AgentSession) => {
    rememberWorkspace(session.cwd);
    setSessions((current) => {
      const entry = current.find((candidate) => candidate.id === session.id);
      if (!entry) return [...current, session];

      const next = { ...session, unread: entry.unread || session.unread };
      if (
        entry.cwd === next.cwd &&
        entry.title === next.title &&
        entry.name === next.name &&
        entry.status === next.status &&
        entry.active === next.active &&
        entry.waiting === next.waiting &&
        entry.unread === next.unread
      ) {
        return current;
      }
      return current.map((candidate) =>
        candidate.id === session.id ? next : candidate,
      );
    });
  };

  const handleEvent = (event: AgentManagerEvent) => {
    // Main-process events are the source of truth; client state only decorates them.
    if (event.type === "sessions") {
      for (const session of event.sessions) rememberWorkspace(session.cwd);
      if (!selectedWorkspace() && event.sessions[0]) {
        setSelectedWorkspace(event.sessions[0].cwd);
      }
      setSessions((current) => {
        const unread = new Map(
          current.map((session) => [session.id, session.unread]),
        );
        return event.sessions.map((session) => ({
          ...session,
          unread: unread.get(session.id) ?? false,
        }));
      });
      return;
    }

    if (event.type === "session_update") {
      updateSession(event.session);
      ensureState(event.session.id);
      return;
    }

    if (event.type === "session_history") {
      ensureState(event.sessionId);
      queueHistory(event.sessionId, event.items);
      return;
    }

    if (event.type === "feedback_request") {
      setSessions((current) =>
        current.map((session) =>
          session.id === event.sessionId
            ? {
                ...session,
                waiting: event.request,
                status: "waiting",
                active: true,
              }
            : session,
        ),
      );
      ensureState(event.sessionId);
      return;
    }

    if (event.type === "session_event") {
      ensureState(event.sessionId);
      queueStateEvent(event.sessionId, event.event);
      if (event.sessionId !== selectedId()) {
        setSessions((current) => {
          const session = current.find(
            (candidate) => candidate.id === event.sessionId,
          );
          if (!session || session.unread) return current;
          return current.map((candidate) =>
            candidate.id === event.sessionId
              ? { ...candidate, unread: true }
              : candidate,
          );
        });
      }
    }
  };

  onMount(() => {
    // Subscribe before listing so a fast session update cannot be missed.
    const unsubscribe = api.agent.onEvent(handleEvent);
    onCleanup(unsubscribe);
    onCleanup(() => {
      if (stateFrame !== undefined) cancelAnimationFrame(stateFrame);
      stateFrame = undefined;
      stateFlushScheduled = false;
      pendingStateEvents.clear();
    });
    void api.agent
      .list()
      .then((next) => {
        setSessions(next);
        for (const session of next) {
          rememberWorkspace(session.cwd);
          ensureState(session.id);
        }
        if (!selectedWorkspace() && next[0]) {
          setSelectedWorkspace(next[0].cwd);
        }
      })
      .catch(reportError);
  });

  const selectSession = (id: string) => {
    ensureState(id);
    setSelectedId(id);
    setSessions((current) =>
      current.map((session) =>
        session.id === id ? { ...session, unread: false } : session,
      ),
    );
  };

  const openSession = (id: string) => {
    const session = sessions().find((entry) => entry.id === id);
    if (!session) return;

    ensureState(id);
    setTabs((current) => (current.includes(id) ? current : [...current, id]));
    selectSession(id);

    if (!session.active) {
      // Opening starts Pi; discovery commands must wait for its initial handshake.
      void api.agent
        .open(id)
        .then(() => {
          void api.agent
            .command(id, { type: "get_available_models" })
            .catch(reportError);
          void api.agent
            .command(id, { type: "get_available_thinking_levels" })
            .catch(reportError);
        })
        .catch(reportError);
    }
  };

  const closeTab = (id: string) => {
    void api.agent.close(id).catch(reportError);
    const current = tabs();
    const index = current.indexOf(id);
    const next = current.filter((tabId) => tabId !== id);
    setTabs(next);
    if (selectedId() !== id) return;

    const replacement = next[index] ?? next[index - 1];
    if (replacement) selectSession(replacement);
    else setSelectedId(undefined);
  };

  const createSession = async (cwd: string) => {
    try {
      selectWorkspace(cwd);
      const session = await api.agent.create(cwd);
      updateSession(session);
      ensureState(session.id);
      openSession(session.id);
    } catch (error) {
      reportError(error);
    }
  };

  const newSession = () => {
    void createSession(workspaceCwd() ?? "");
  };

  const newSessionInWorkspace = () => {
    void api.workspace
      .pick()
      .then((cwd) => {
        if (cwd) void createSession(cwd);
      })
      .catch(reportError);
  };

  const prompt = (
    message: string,
    streamingBehavior?: AgentStreamingBehavior,
  ) => {
    // Optimistically render the user's message while Pi streams its response.
    const id = selectedId();
    if (!id) return;
    updateState(id, (state) => ({
      ...state,
      draft: "",
      messages: [
        ...state.messages,
        { id: crypto.randomUUID(), role: "user", text: message },
      ],
    }));
    void api.agent.prompt(id, message, streamingBehavior).catch(reportError);
  };

  const command = (value: AgentCommand) => {
    const id = selectedId();
    if (!id) return;
    void api.agent.command(id, value).catch(reportError);
  };

  const respond = (response: AgentFeedbackResponse) => {
    const id = selectedId();
    if (!id) return;
    void api.agent.respond(id, response).catch(reportError);
  };

  const abort = () => {
    const id = selectedId();
    if (id) void api.agent.abort(id).catch(reportError);
  };

  const waitingSessions = createMemo(() =>
    sessions().filter((session) => session.status === "waiting"),
  );

  const selectActivityView = (view: ActivityView) => {
    if (view === activityView() && !panels.leftCollapsed()) {
      panels.toggleCollapsed("left");
      return;
    }

    setActivityView(view);
    if (panels.leftCollapsed()) panels.toggleCollapsed("left");
  };

  return (
    <main class="app-shell">
      <MenuBar
        primarySidebarCollapsed={panels.leftCollapsed()}
        secondarySidebarCollapsed={panels.rightCollapsed()}
        panelCollapsed={panels.panelCollapsed()}
        onTogglePrimarySidebar={() => panels.toggleCollapsed("left")}
        onToggleSecondarySidebar={() => panels.toggleCollapsed("right")}
        onTogglePanel={() => panels.toggleCollapsed("bottom")}
      />

      <div class="workbench">
        <ActivityBar selected={activityView()} onSelect={selectActivityView} />

        <div
          class={`workspace-layout ${panels.leftCollapsed() ? "is-primary-sidebar-collapsed" : ""} ${panels.rightCollapsed() ? "is-secondary-sidebar-collapsed" : ""}`}
          ref={panels.setLayout}
          style={`--left-panel-width: ${panels.leftWidth()}px; --right-panel-width: ${panels.rightWidth()}px; --panel-height: ${panels.panelHeight()}px;`}
        >
          <aside
            id="primary-sidebar"
            class={`panel side-panel left-panel ${panels.leftCollapsed() ? "is-collapsed" : ""}`}
          >
            <PanelHeader title={activityLabels[activityView()]} />
            {activityView() === "explorer" && (
              <ExplorerSidebar
                cwd={workspaceCwd()}
                workspaces={workspaces()}
                onSelectWorkspace={selectWorkspace}
                onPickWorkspace={newSessionInWorkspace}
              />
            )}
            {activityView() === "source-control" && (
              <SourceControlSidebar cwd={workspaceCwd()} />
            )}
          </aside>

          <PanelResizer
            target="left"
            value={panels.leftWidth}
            label="Resize primary side bar and view border"
            controls="primary-sidebar view"
            onPointerDown={(event) => panels.startResize("left", event)}
            onKeyDown={(event) => panels.handleKeyDown("left", event)}
          />

          <div
            class={`view-area ${panels.panelCollapsed() ? "is-panel-collapsed" : ""}`}
          >
            <AgentView
              tabs={tabSessions()}
              selectedSession={selectedSession()}
              state={selectedState()}
              onSelectTab={selectSession}
              onCloseTab={closeTab}
              onNewSession={newSession}
              onDraft={(value) => {
                const id = selectedId();
                if (id)
                  updateState(id, (state) => ({ ...state, draft: value }));
              }}
              onPrompt={prompt}
              onAbort={abort}
              onCommand={command}
              onRespond={respond}
            />

            <PanelResizer
              target="bottom"
              value={panels.panelHeight}
              label="Resize panel top border"
              controls="view panel"
              onPointerDown={(event) => panels.startResize("bottom", event)}
              onKeyDown={(event) => panels.handleKeyDown("bottom", event)}
            />

            <section
              id="panel"
              class={`panel bottom-panel ${panels.panelCollapsed() ? "is-collapsed" : ""}`}
            >
              <PanelHeader title="Panel" />
            </section>
          </div>

          <PanelResizer
            target="right"
            value={panels.rightWidth}
            label="Resize view and secondary side bar border"
            controls="view secondary-sidebar"
            onPointerDown={(event) => panels.startResize("right", event)}
            onKeyDown={(event) => panels.handleKeyDown("right", event)}
          />

          <aside
            id="secondary-sidebar"
            class={`panel side-panel right-panel session-panel ${panels.rightCollapsed() ? "is-collapsed" : ""}`}
          >
            <SessionSidebar
              sessions={sessions()}
              openTabIds={tabs()}
              onOpen={openSession}
              onNew={newSession}
              selectedSessionId={selectedId()}
              workspaceCwd={workspaceCwd()}
            />
          </aside>
        </div>
      </div>

      <StatusBar
        waitingSessions={waitingSessions()}
        onSelectSession={openSession}
      />
    </main>
  );
}
