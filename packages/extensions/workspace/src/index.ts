import type { ExtensionDefinition, JsonValue } from "@aria/core";
import { WorkspaceService } from "./service";

export { parseGitStatus, runGit } from "./git";
export { WorkspaceService } from "./service";
export * from "./types";

/** Public capability names owned by the Workspace extension. */
export const WORKSPACE_CAPABILITIES = [
  "workspace.readDirectory",
  "workspace.gitStatus",
  "workspace.gitStage",
  "workspace.gitUnstage",
  "workspace.gitCommit",
] as const;

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

/** Main-process extension for local filesystem and Git operations. */
export const workspaceExtension: ExtensionDefinition = {
  id: "workspace",
  execution: "main",
  capabilities: WORKSPACE_CAPABILITIES,
  create(context) {
    const service = new WorkspaceService();
    let cleanups: Array<() => void> = [];
    return {
      start() {
        cleanups = [
          context.provide("workspace.readDirectory", (payload) =>
            service.readDirectory(payload).then(asJson),
          ),
          context.provide("workspace.gitStatus", (payload) =>
            service.gitStatus(payload).then(asJson),
          ),
          context.provide("workspace.gitStage", async (payload) => {
            await service.gitStage(payload);
            return null;
          }),
          context.provide("workspace.gitUnstage", async (payload) => {
            await service.gitUnstage(payload);
            return null;
          }),
          context.provide("workspace.gitCommit", async (payload) => {
            await service.gitCommit(payload);
            return null;
          }),
        ];
      },
      stop() {
        for (const cleanup of cleanups.reverse()) cleanup();
        cleanups = [];
      },
    };
  },
};

export default workspaceExtension;
