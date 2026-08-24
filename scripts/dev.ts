import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";
import { createJiti } from "jiti";
import { createServer, type UserConfig } from "vite";

const root = process.cwd();
const outputDirectory = resolve(root, "dist");
const jiti = createJiti(import.meta.url);
const viteConfig = await jiti.import<UserConfig>("../vite.config.ts", {
  default: true,
});

await build({
  entryPoints: ["src/main/main.ts", "src/preload/preload.ts"],
  bundle: true,
  external: ["electron"],
  format: "cjs",
  outdir: outputDirectory,
  outExtension: { ".js": ".cjs" },
  platform: "node",
});

const server = await createServer({
  ...viteConfig,
  configFile: false,
  root,
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
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);
const electron = spawn(
  electronCommand,
  [resolve(outputDirectory, "main/main.cjs")],
  {
    env: {
      ...process.env,
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
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (electron.exitCode === null) {
    electron.kill();
  }
  await server.close();
  process.exit(code);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
electron.once("exit", (code, signal) => {
  void shutdown(code ?? (signal ? 1 : 0));
});
