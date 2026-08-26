import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createCore } from "../src";

async function temporaryDirectory() {
  return mkdtemp(join(tmpdir(), "aria-core-"));
}

async function writeModule(directory: string, name: string, content: string) {
  const path = join(directory, name);
  await writeFile(path, content, "utf8");
  return path;
}

const mainExtension = (id: string, capabilities: string[] = []) => `{
  id: ${JSON.stringify(id)},
  execution: "main",
  capabilities: ${JSON.stringify(capabilities)},
  create(context) {
    return {
      start() {},
      stop() {},
    };
  },
}`;

describe("CoreRuntime", () => {
  it("discovers files and packages with one or many definitions", async () => {
    const directory = await temporaryDirectory();
    const core = createCore({ extensionSources: [directory] });

    await writeModule(
      directory,
      "single.mjs",
      `export default ${mainExtension("single")};`,
    );
    const packageDirectory = join(directory, "multiple");
    await mkdir(packageDirectory);
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({ type: "module", main: "index.mjs" }),
      "utf8",
    );
    await writeModule(
      packageDirectory,
      "index.mjs",
      `export default [
        ${mainExtension("first")},
        ${mainExtension("second")},
      ];`,
    );
    await writeModule(
      directory,
      "invalid.mjs",
      'export default { id: "invalid" };\n',
    );

    try {
      const report = await core.initialize();
      assert.deepEqual(report.registered, ["first", "second", "single"]);
      assert.equal(report.issues.length, 1);
      assert.equal(core.getExtension("first")?.state, "ready");
      assert.equal(core.getExtension("invalid"), undefined);
    } finally {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("starts dependencies in order and reference-counts shared dependencies", async () => {
    const directory = await temporaryDirectory();
    const coreEvents: string[] = [];
    const core = createCore({
      extensionSources: [directory],
      onEvent: (event) => {
        if (event.type === "extension_started")
          coreEvents.push(event.extensionId);
      },
    });

    await writeModule(
      directory,
      "provider.mjs",
      `export default {
        id: "provider",
        execution: "main",
        capabilities: ["provider.echo"],
        create(context) {
          return {
            start() { context.provide("provider.echo", (payload) => payload); },
            stop() {},
          };
        },
      };`,
    );
    await writeModule(
      directory,
      "first.mjs",
      `export default {
        id: "first",
        execution: "main",
        dependencies: ["provider"],
        capabilities: ["first"],
        create(context) {
          return {
            start() { context.provide("first", () => "first"); },
            stop() {},
          };
        },
      };`,
    );
    await writeModule(
      directory,
      "second.mjs",
      `export default {
        id: "second",
        execution: "main",
        dependencies: ["provider"],
        capabilities: ["second"],
        create(context) {
          return {
            start() { context.provide("second", () => "second"); },
            stop() {},
          };
        },
      };`,
    );

    try {
      await core.initialize();
      await core.start("provider");
      await core.start("first");
      await core.start("second");

      assert.deepEqual(coreEvents.slice(0, 3), ["provider", "first", "second"]);
      assert.equal(core.getExtension("provider")?.consumers, 2);

      await core.stop("first");
      assert.equal(core.getExtension("provider")?.state, "running");
      assert.equal(core.getExtension("provider")?.consumers, 1);

      await core.stop("second");
      assert.equal(core.getExtension("provider")?.state, "running");
      assert.equal(core.getExtension("provider")?.consumers, 0);

      await core.stop("provider");
      assert.equal(core.getExtension("provider")?.state, "ready");
    } finally {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("routes events through the main-process event bus", async () => {
    const directory = await temporaryDirectory();
    const core = createCore({ extensionSources: [directory] });

    await writeModule(
      directory,
      "listener.mjs",
      `export default {
        id: "listener",
        execution: "main",
        capabilities: ["listener.last"],
        create(context) {
          let last = null;
          return {
            start() {
              context.subscribe("sample", (event) => { last = event.payload; });
              context.provide("listener.last", () => last);
            },
            stop() {},
          };
        },
      };`,
    );
    await writeModule(
      directory,
      "emitter.mjs",
      `export default {
        id: "emitter",
        execution: "main",
        capabilities: ["emitter.publish"],
        create(context) {
          return {
            start() { context.provide("emitter.publish", (payload) => { context.publish({ type: "sample", payload }); return null; }); },
            stop() {},
          };
        },
      };`,
    );

    try {
      await core.start("listener");
      await core.request("emitter.publish", { value: 7 });
      assert.deepEqual(await core.request("listener.last", null), { value: 7 });
    } finally {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("routes events across a child boundary", async () => {
    const directory = await temporaryDirectory();
    const core = createCore({
      extensionSources: [directory],
      handshakeTimeoutMs: 5000,
      requestTimeoutMs: 5000,
    });

    await writeModule(
      directory,
      "child-listener.mjs",
      `export default {
        id: "child.listener",
        capabilities: ["child.last"],
        create(context) {
          let last = null;
          return {
            start() {
              context.subscribe("sample", (event) => { last = event.payload; });
              context.provide("child.last", () => last);
            },
            stop() {},
          };
        },
      };`,
    );
    await writeModule(
      directory,
      "main-emitter.mjs",
      `export default {
        id: "main.emitter",
        execution: "main",
        capabilities: ["main.emit"],
        create(context) {
          return {
            start() { context.provide("main.emit", (payload) => { context.publish({ type: "sample", payload }); return null; }); },
            stop() {},
          };
        },
      };`,
    );

    try {
      await core.start("child.listener");
      await core.request("main.emit", { value: "remote" });
      assert.deepEqual(await core.request("child.last", null), {
        value: "remote",
      });
    } finally {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("handshakes child and worker boundaries before lazy instance startup", async () => {
    const directory = await temporaryDirectory();
    const core = createCore({
      extensionSources: [directory],
      handshakeTimeoutMs: 5000,
      requestTimeoutMs: 5000,
    });

    const child = `export default {
      id: "child.echo",
      capabilities: ["child.echo"],
      create(context) {
        return {
          start() { context.provide("child.echo", (payload) => payload); },
          stop() {},
        };
      },
    };`;
    const worker = `export default {
      id: "worker.echo",
      execution: "worker",
      capabilities: ["worker.echo"],
      create(context) {
        return {
          start() { context.provide("worker.echo", (payload) => payload); },
          stop() {},
        };
      },
    };`;
    await writeModule(directory, "child.mjs", child);
    await writeModule(directory, "worker.mjs", worker);

    try {
      await core.initialize();
      assert.equal(core.getExtension("child.echo")?.state, "ready");
      assert.equal(core.getExtension("worker.echo")?.state, "ready");

      assert.deepEqual(await core.request("child.echo", { value: "child" }), {
        value: "child",
      });
      assert.deepEqual(await core.request("worker.echo", { value: "worker" }), {
        value: "worker",
      });
      assert.equal(core.getExtension("child.echo")?.state, "running");
      assert.equal(core.getExtension("worker.echo")?.state, "running");

      await core.stop("child.echo");
      await core.stop("worker.echo");
      assert.equal(core.getExtension("child.echo")?.state, "ready");
      assert.equal(core.getExtension("worker.echo")?.state, "ready");
      assert.deepEqual(await core.request("child.echo", { value: "again" }), {
        value: "again",
      });
    } finally {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks missing dependencies and cycles as registration failures", async () => {
    const directory = await temporaryDirectory();
    const core = createCore({ extensionSources: [directory] });

    await writeModule(
      directory,
      "missing.mjs",
      `export default {
        id: "missing-user",
        execution: "main",
        dependencies: ["missing"],
        create() { return { start() {}, stop() {} }; },
      };`,
    );
    await writeModule(
      directory,
      "cycle-a.mjs",
      `export default {
        id: "cycle-a",
        execution: "main",
        dependencies: ["cycle-b"],
        create() { return { start() {}, stop() {} }; },
      };`,
    );
    await writeModule(
      directory,
      "cycle-b.mjs",
      `export default {
        id: "cycle-b",
        execution: "main",
        dependencies: ["cycle-a"],
        create() { return { start() {}, stop() {} }; },
      };`,
    );

    try {
      const report = await core.initialize();
      assert.match(
        report.issues.find((issue) => issue.source.endsWith("missing.mjs"))
          ?.error ?? "",
        /Missing dependency: missing/,
      );
      assert.equal(core.getExtension("missing-user")?.state, "failed");
      assert.equal(core.getExtension("cycle-a")?.state, "failed");
      assert.equal(core.getExtension("cycle-b")?.state, "failed");
    } finally {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks a failed dependency and its dependent as failed", async () => {
    const directory = await temporaryDirectory();
    const core = createCore({ extensionSources: [directory] });

    await writeModule(
      directory,
      "broken.mjs",
      `export default {
        id: "broken",
        execution: "main",
        capabilities: ["broken"],
        create() {
          return {
            start() { throw new Error("broken start"); },
            stop() {},
          };
        },
      };`,
    );
    await writeModule(
      directory,
      "dependent.mjs",
      `export default {
        id: "dependent",
        execution: "main",
        dependencies: ["broken"],
        create() { return { start() {}, stop() {} }; },
      };`,
    );

    try {
      await core.initialize();
      await assert.rejects(core.start("dependent"), /broken start/);
      assert.equal(core.getExtension("broken")?.state, "failed");
      assert.equal(core.getExtension("dependent")?.state, "failed");
    } finally {
      await core.shutdown();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
