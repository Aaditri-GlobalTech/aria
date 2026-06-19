export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.ARIA_EXPERIMENTAL === "1";
}
