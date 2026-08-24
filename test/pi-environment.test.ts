import { describe, expect, it } from "vitest";
import { piEnvironment } from "../src/main/pi-environment";

describe("Pi environment", () => {
  it("finds user-installed Pi when the desktop PATH is minimal", () => {
    const env = piEnvironment(
      { HOME: "/home/kumar", PATH: "/usr/bin:/bin" },
      "linux",
    );

    expect(env.PATH).toBe(
      "/home/kumar/.local/npm-global/bin:/home/kumar/.npm-global/bin:/home/kumar/.npm-packages/bin:/home/kumar/.local/bin:/home/kumar/.volta/bin:/usr/bin:/bin",
    );
  });
});
