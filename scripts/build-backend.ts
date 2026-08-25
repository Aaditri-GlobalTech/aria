import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(
  repositoryRoot,
  "packages",
  "host",
  "src",
  "index.ts",
);
const outputDirectory = resolve(repositoryRoot, "app", "resources", "backend");
const outputPath = resolve(
  outputDirectory,
  `aria-backend${process.platform === "win32" ? ".exe" : ""}`,
);

const targets: Record<string, Record<string, string>> = {
  linux: {
    x64: "bun-linux-x64",
    arm64: "bun-linux-arm64",
  },
  win32: {
    x64: "bun-windows-x64",
    arm64: "bun-windows-arm64",
  },
  darwin: {
    x64: "bun-darwin-x64",
    arm64: "bun-darwin-arm64",
  },
};
const target = targets[process.platform]?.[process.arch];
if (!target) {
  throw new Error(
    `Unsupported Bun sidecar target: ${process.platform}/${process.arch}`,
  );
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    "build",
    "--compile",
    "--target",
    target,
    "--outfile",
    outputPath,
    sourcePath,
  ],
  { cwd: repositoryRoot, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

console.log(`Built ${target} sidecar: ${outputPath}`);
