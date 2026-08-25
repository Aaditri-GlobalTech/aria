// Build the Electron entrypoints first, then run Vite and Electron together.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createJiti } from "jiti";
import { createServer, type UserConfig } from "vite";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(appDirectory, "..");
const outputDirectory = resolve(appDirectory, "dist");
const hostSourcePath = resolve(
  repositoryRoot,
  "packages",
  "host",
  "src",
  "index.ts",
);
const jiti = createJiti(import.meta.url);
const viteConfig = await jiti.import<UserConfig>(
  resolve(appDirectory, "vite.config.ts"),
  { default: true },
);

// The main process is bundled separately because Electron is provided at runtime.
await build({
  entryPoints: [
    resolve(appDirectory, "src/main/main.ts"),
    resolve(appDirectory, "src/preload/preload.ts"),
  ],
  bundle: true,
  external: ["electron"],
  format: "cjs",
  outdir: outputDirectory,
  outExtension: { ".js": ".cjs" },
  platform: "node",
});

// Renderer assets remain hot-reloadable while Electron uses the dev URL.
const server = await createServer({
  ...viteConfig,
  configFile: false,
  root: appDirectory,
  server: {
    ...viteConfig.server,
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();

const electronCommand = resolve(
  appDirectory,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);
const hostRuntime =
  process.env.ARIA_HOST_RUNTIME ??
  (process.versions.bun ? process.execPath : "bun");
const electron = spawn(
  electronCommand,
  [resolve(outputDirectory, "main/main.cjs")],
  {
    cwd: appDirectory,
    env: {
      ...process.env,
      ARIA_HOST_CWD: repositoryRoot,
      ARIA_HOST_RUNTIME: hostRuntime,
      ARIA_HOST_SOURCE_PATH: hostSourcePath,
      ELECTRON_PRELOAD_PATH: resolve(outputDirectory, "preload/preload.cjs"),
      VITE_DEV_SERVER_URL:
        server.resolvedUrls?.local[0] ?? "http://127.0.0.1:5173",
    },
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

let shuttingDown = false;

async function shutdown(code: number) {
  if (shuttingDown) return;

  // Stop both processes exactly once so Ctrl-C does not leave a dev server behind.
  shuttingDown = true;
  if (electron.exitCode === null) electron.kill();
  await server.close();
  process.exit(code);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
electron.once("exit", (code, signal) => {
  void shutdown(code ?? (signal ? 1 : 0));
});
