import { describe, expect, it } from "vitest";
import { APP_NAME } from "../src/renderer/App";

describe("app skeleton", () => {
  it("has an application name", () => {
    expect(APP_NAME).toBe("Aria");
  });
});
