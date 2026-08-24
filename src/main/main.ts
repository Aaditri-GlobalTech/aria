import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

const directory = typeof __dirname === "undefined" ? process.cwd() : __dirname;

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

ipcMain.on("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.on("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
