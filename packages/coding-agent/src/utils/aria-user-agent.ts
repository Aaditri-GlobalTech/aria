export function getAriaUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `aria/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
