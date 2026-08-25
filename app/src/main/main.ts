import { join } from "node:path";
import type {
  AgentManagerEvent,
  AgentSession,
  ExplorerEntry,
  GitStatus,
  JsonRpcParams,
} from "@aria/protocol";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";
import { BackendClient } from "./backend-client";

const directory = typeof __dirname === "undefined" ? process.cwd() : __dirname;

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let quitAfterBackendStop = false;
let quitPromise: Promise<void> | undefined;

/** Send core state changes only while a renderer window is available. */
function sendManagerEvent(event: AgentManagerEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("agent:event", event);
}

const backend = new BackendClient({
  onEvent: sendManagerEvent,
  hostSourcePath: process.env.ARIA_HOST_SOURCE_PATH,
  hostRuntime: process.env.ARIA_HOST_RUNTIME,
  hostCwd: process.env.ARIA_HOST_CWD,
});

function rpcParams(value: unknown): JsonRpcParams {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new Error("Backend params must be an object or array");
}

/** Embedded PNG keeps the tray icon visible on Linux Electron builds. */
const trayIcon = nativeImage.createFromDataURL(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAZklEQVR4nO3TyxEAEBADUJVoQ1eqUY/WKAAj2LE+yUxuyLsw1sekWXMMwIW0tQQQsAyohYA/AK3BUQgBwwB0AD13NwCNCEAi7wDQn4Lc6wJmh9F3CGgCpIZ7kHMBu0oAAQVAq+qADE+tTCWSUYUnAAAAAElFTkSuQmCC",
);

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}

/** Keep the process alive while the window is hidden and expose restore/quit actions. */
function createTray() {
  tray = new Tray(trayIcon);
  tray.setToolTip("Aria");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Aria", click: showMainWindow },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
  tray.on("click", toggleMainWindow);
}

/** Create the isolated renderer and choose dev-server or packaged assets. */
function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload:
        process.env.ELECTRON_PRELOAD_PATH ??
        join(directory, "../preload/preload.cjs"),
    },
  });
  mainWindow = window;
  // Closing the window hides it; only the tray's Quit action ends the process.
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  const syncMaximizedState = () =>
    window.webContents.send("window:maximized", window.isMaximized());
  window.on("maximize", syncMaximizedState);
  window.on("unmaximize", syncMaximizedState);
  window.webContents.on("did-finish-load", syncMaximizedState);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(directory, "../index.html"));
  }
}

// Electron remains the adapter for the existing renderer-facing channels.
ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("agent:list", () =>
  backend.request<AgentSession[]>("agent.list"),
);
ipcMain.handle("agent:create", (_event, cwd: unknown) =>
  backend.request<AgentSession>("agent.create", { cwd }),
);
ipcMain.handle("agent:open", (_event, id: unknown) =>
  backend.request<AgentSession>("agent.open", { sessionId: id }),
);
ipcMain.handle("agent:prompt", async (_event, value: unknown) => {
  await backend.request("agent.prompt", rpcParams(value));
});
ipcMain.handle("agent:abort", async (_event, id: unknown) => {
  await backend.request("agent.abort", { sessionId: id });
});
ipcMain.handle("agent:command", async (_event, value: unknown) => {
  await backend.request("agent.command", rpcParams(value));
});
ipcMain.handle("agent:respond", async (_event, value: unknown) => {
  await backend.request("agent.respond", rpcParams(value));
});

// Workspace picking and native window/tray lifecycle remain Electron-only.
ipcMain.handle("workspace:pick", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open workspace",
    properties: ["openDirectory"],
  });
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle("workspace:read-directory", (_event, value: unknown) =>
  backend.request<ExplorerEntry[]>("workspace.readDirectory", rpcParams(value)),
);

ipcMain.handle("workspace:git-status", (_event, cwd: unknown) =>
  backend.request<GitStatus>("workspace.gitStatus", { cwd }),
);

ipcMain.handle("workspace:git-stage", async (_event, value: unknown) => {
  await backend.request("workspace.gitStage", rpcParams(value));
});

ipcMain.handle("workspace:git-unstage", async (_event, value: unknown) => {
  await backend.request("workspace.gitUnstage", rpcParams(value));
});

ipcMain.handle("workspace:git-commit", async (_event, value: unknown) => {
  await backend.request("workspace.gitCommit", rpcParams(value));
});

app.on("before-quit", (event) => {
  if (quitAfterBackendStop) return;
  event.preventDefault();
  isQuitting = true;
  if (quitPromise) return;

  quitPromise = backend
    .stop()
    .catch((error) => {
      console.error("Failed to shut down Aria backend:", error);
    })
    .finally(() => {
      quitAfterBackendStop = true;
      app.quit();
    });
});

void app
  .whenReady()
  .then(async () => {
    if (isQuitting) return;
    try {
      await backend.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      dialog.showErrorBox("Aria backend failed to start", message);
      app.exit(1);
      return;
    }

    createTray();
    createWindow();
    app.on("activate", showMainWindow);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Aria failed to start:", message);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
