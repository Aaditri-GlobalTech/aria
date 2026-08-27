import type { AgentSession } from "@aria/extension-agent";
import { describe, expect, it } from "vitest";
import { groupSessions } from "../src/renderer/components/panels/SessionSidebar";

function session(
  id: string,
  cwd: string,
  lastActivity: string,
  active = false,
): AgentSession {
  return {
    id,
    cwd,
    title: id,
    status: "idle",
    active,
    unread: false,
    lastActivity,
  };
}

describe("session groups", () => {
  it("puts the selected workspace first and selected or active sessions first", () => {
    const groups = groupSessions(
      [
        session("other", "/other", "2026-01-03"),
        session("other-first", "/z-other", "2026-01-01"),
        session("other-second", "/a-other", "2026-01-04"),
        session("old", "/selected", "2026-01-01"),
        session("active", "/selected", "2026-01-02", true),
        session("new", "/selected", "2026-01-04"),
      ],
      "/selected",
      "old",
    );

    expect(
      groups.map(([cwd, entries]) => [cwd, entries.map(({ id }) => id)]),
    ).toEqual([
      ["/selected", ["old", "active", "new"]],
      ["/other", ["other"]],
      ["/z-other", ["other-first"]],
      ["/a-other", ["other-second"]],
    ]);
    expect(groupSessions([], "/selected")).toEqual([["/selected", []]]);
  });
});
