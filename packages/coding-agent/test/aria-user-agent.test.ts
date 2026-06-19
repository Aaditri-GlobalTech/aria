import { describe, expect, it } from "vitest";
import { getAriaUserAgent } from "../src/utils/aria-user-agent.ts";

describe("getAriaUserAgent", () => {
	it("formats the user agent expected by aria.dev", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getAriaUserAgent("1.2.3");

		expect(userAgent).toBe(`aria/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^aria\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
