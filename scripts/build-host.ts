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
  "main.ts",
);
const outputDirectory = resolve(repositoryRoot, "app", "resources", "host");
const extensionOutputDirectory = resolve(
  repositoryRoot,
  "app",
  "resources",
  "extensions",
);
const outputPath = resolve(
  outputDirectory,
  `aria-host${process.platform === "win32" ? ".exe" : ""}`,
);
// Keep feature bundles separate so the host remains generic and sources stay replaceable.
const extensionBundles = [
  {
    name: "agent",
    source: resolve(
      repositoryRoot,
      "packages",
      "extensions",
      "agent",
      "src",
      "index.ts",
    ),
  },
  {
    name: "workspace",
    source: resolve(
      repositoryRoot,
      "packages",
      "extensions",
      "workspace",
      "src",
      "index.ts",
    ),
  },
];

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
    `Unsupported Bun host target: ${process.platform}/${process.arch}`,
  );
}

await rm(outputDirectory, { recursive: true, force: true });
await rm(extensionOutputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await mkdir(extensionOutputDirectory, { recursive: true });

function runBunBuild(args: string[]): void {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runBunBuild([
  "build",
  "--compile",
  "--target",
  target,
  "--outfile",
  outputPath,
  sourcePath,
]);

for (const extension of extensionBundles) {
  runBunBuild([
    "build",
    "--target",
    "bun",
    "--format",
    "cjs",
    "--outfile",
    resolve(extensionOutputDirectory, `${extension.name}.cjs`),
    extension.source,
  ]);
}

console.log(`Built ${target} host: ${outputPath}`);
