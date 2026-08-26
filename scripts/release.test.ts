import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const releaseScript = fileURLToPath(new URL("./release.ts", import.meta.url));
const temporaryDirectories: string[] = [];

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function run(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(cwd: string, args: string[]): string {
  const result = run("git", args, cwd);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`.trim());
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aria-release-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "app"), { recursive: true });
  await mkdir(join(root, "packages", "core"), { recursive: true });
  await copyFile(releaseScript, join(root, "release.ts"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "test-repository",
        private: true,
        scripts: { check: "true", release: "bun run release.ts" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, "app", "package.json"),
    JSON.stringify({ name: "aria", version: "1.2.3", private: true }, null, 2) +
      "\n",
  );
  for (const path of [
    join(root, "CHANGELOG.md"),
    join(root, "app", "CHANGELOG.md"),
    join(root, "packages", "core", "CHANGELOG.md"),
  ]) {
    await writeFile(
      path,
      "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Test change.\n",
    );
  }

  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "Release Test"],
    ["config", "user.email", "release-test@example.invalid"],
    ["add", "."],
    ["commit", "-qm", "Initial commit"],
  ]) {
    assert.equal(run("git", args, root).status, 0);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("release script", () => {
  it("bumps, validates, commits, tags, and resets changelogs", async () => {
    const root = await createRepository();
    const result = run(
      process.execPath,
      ["run", "release", "--", "patch"],
      root,
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      JSON.parse(await readFile(join(root, "app", "package.json"), "utf8"))
        .version,
      "1.2.4",
    );
    assert.equal(git(root, ["tag", "--list"]), "v1.2.4");
    assert.equal(git(root, ["cat-file", "-t", "v1.2.4"]), "tag");
    assert.equal(
      git(root, [
        "for-each-ref",
        "--format=%(contents:subject)",
        "refs/tags/v1.2.4",
      ]),
      "Release v1.2.4",
    );
    assert.equal(
      git(root, ["show", "-s", "--format=%s", "v1.2.4^{}"]),
      "Release v1.2.4",
    );
    assert.equal(
      git(root, ["show", "-s", "--format=%s", "HEAD"]),
      "Start next development cycle",
    );
    assert.match(
      await readFile(join(root, "CHANGELOG.md"), "utf8"),
      /^# Changelog\n\n## \[Unreleased\]\n\n## \[1\.2\.4\] - \d{4}-\d{2}-\d{2}/,
    );
    assert.equal(git(root, ["status", "--porcelain"]), "");
  });

  it("rejects a dirty repository before changing the version", async () => {
    const root = await createRepository();
    await writeFile(join(root, "dirty.txt"), "uncommitted\n");

    const result = run(
      process.execPath,
      ["run", "release", "--", "patch"],
      root,
    );

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Working directory must be clean/,
    );
    assert.equal(
      JSON.parse(await readFile(join(root, "app", "package.json"), "utf8"))
        .version,
      "1.2.3",
    );
    assert.equal(git(root, ["tag", "--list"]), "");
  });
});
