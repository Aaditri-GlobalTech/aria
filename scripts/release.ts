import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const BUMP_TYPES = new Set(["major", "minor", "patch"]);
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const repositoryRoot = process.cwd();
const appPackagePath = join(repositoryRoot, "app", "package.json");

type PackageJson = {
  version?: unknown;
  [key: string]: unknown;
};

type CommandOptions = {
  capture?: boolean;
};

function run(
  command: string,
  args: string[],
  options: CommandOptions = {},
): string {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(
      output
        ? `Command failed: ${command} ${args.join(" ")}\n${output}`
        : `Command failed: ${command} ${args.join(" ")}`,
    );
  }
  return result.stdout ?? "";
}

function parseVersion(version: string): [number, number, number] {
  const match = VERSION_PATTERN.exec(version);
  if (!match) throw new Error(`Invalid app version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index++) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function nextVersion(current: string, target: string): string {
  if (VERSION_PATTERN.test(target)) {
    if (compareVersions(target, current) <= 0) {
      throw new Error(
        `Explicit version ${target} must be greater than current version ${current}`,
      );
    }
    return target;
  }
  if (!BUMP_TYPES.has(target)) {
    throw new Error("Usage: bun run release -- <major|minor|patch|x.y.z>");
  }

  const [major, minor, patch] = parseVersion(current);
  if (target === "major") return `${major + 1}.0.0`;
  if (target === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function changelogPaths(): string[] {
  return run("git", ["ls-files", "--", "*CHANGELOG.md"], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => join(repositoryRoot, path));
}

function promoteChangelogs(version: string): string[] {
  const date = new Date().toISOString().slice(0, 10);
  const updated: string[] = [];

  for (const path of changelogPaths()) {
    const content = readFileSync(path, "utf8");
    if (!/^## \[Unreleased\]\s*$/m.test(content)) continue;
    if (
      new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\]`, "m").test(
        content,
      )
    ) {
      throw new Error(`Changelog already contains version ${version}: ${path}`);
    }
    const next = content.replace(
      /^## \[Unreleased\]\s*$/m,
      `## [${version}] - ${date}`,
    );
    writeFileSync(path, next);
    updated.push(path);
  }

  return updated;
}

function addUnreleasedSections(paths: string[]): void {
  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    const next = content.replace(/^(#.*\n\n)/, "$1## [Unreleased]\n\n");
    if (next === content) throw new Error(`Missing changelog title: ${path}`);
    writeFileSync(path, next);
  }
}

function stage(paths: string[]): void {
  run("git", [
    "add",
    "--",
    ...paths.map((path) => relative(repositoryRoot, path)),
  ]);
}

function main(): void {
  const target = process.argv[2];
  if (!target)
    throw new Error("Usage: bun run release -- <major|minor|patch|x.y.z>");

  const status = run("git", ["status", "--porcelain"], { capture: true });
  if (status.trim()) {
    throw new Error(
      `Working directory must be clean before a release:\n${status}`,
    );
  }

  const packageJson = JSON.parse(
    readFileSync(appPackagePath, "utf8"),
  ) as PackageJson;
  if (typeof packageJson.version !== "string") {
    throw new Error("app/package.json must contain a version");
  }
  const version = nextVersion(packageJson.version, target);
  const tag = `v${version}`;
  const tagExists =
    spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
    }).status === 0;
  if (tagExists) throw new Error(`Tag already exists: ${tag}`);

  packageJson.version = version;
  writeFileSync(appPackagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const releasedChangelogs = promoteChangelogs(version);

  run(process.execPath, ["run", "check"]);
  stage([appPackagePath, ...releasedChangelogs]);
  run("git", ["commit", "-m", `Release ${tag}`]);
  run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);

  if (releasedChangelogs.length > 0) {
    addUnreleasedSections(releasedChangelogs);
    stage(releasedChangelogs);
    run("git", ["commit", "-m", "Start next development cycle"]);
  }

  console.log(
    `Prepared ${tag}. Push the branch and tag with: git push origin HEAD --follow-tags`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
