import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalAriaExperimental = process.env.ARIA_EXPERIMENTAL;

	afterEach(() => {
		if (originalAriaExperimental === undefined) {
			delete process.env.ARIA_EXPERIMENTAL;
		} else {
			process.env.ARIA_EXPERIMENTAL = originalAriaExperimental;
		}
	});

	it("returns false when ARIA_EXPERIMENTAL is unset", () => {
		delete process.env.ARIA_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when ARIA_EXPERIMENTAL is empty", () => {
		process.env.ARIA_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when ARIA_EXPERIMENTAL is set to 1", () => {
		process.env.ARIA_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when ARIA_EXPERIMENTAL is set to 0", () => {
		process.env.ARIA_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when ARIA_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.ARIA_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
