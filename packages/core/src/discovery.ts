import { readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import type { ExecutionMode, ExtensionDefinition } from "./types";

const requireModule = createRequire(import.meta.url);
const moduleExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const executionModes = new Set<ExecutionMode>(["main", "worker", "child"]);
const conventionalEntries = [
  "index.cjs",
  "index.cts",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.mts",
  "index.ts",
  "index.tsx",
];

export type ModuleLoader = (path: string) => unknown | Promise<unknown>;

export type DiscoveryIssue = {
  source: string;
  error: string;
};

export type DiscoveredExtension = {
  definition: ExtensionDefinition;
  source: string;
};

export type DiscoveryResult = {
  candidates: string[];
  definitions: DiscoveredExtension[];
  issues: DiscoveryIssue[];
};

export type DiscoveryOptions = {
  moduleLoader?: ModuleLoader;
  onCandidate?: (source: string) => void;
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function expandHome(path: string) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function isModuleFile(path: string) {
  return moduleExtensions.has(extname(path).toLowerCase());
}

async function isFile(path: string) {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isFile());
}

async function isPackageDirectory(path: string) {
  if (await isFile(join(path, "package.json"))) return true;
  for (const entry of conventionalEntries) {
    if (await isFile(join(path, entry))) return true;
  }
  return false;
}

async function candidatePaths(source: string) {
  const info = await stat(source).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return isModuleFile(source) ? [source] : [];
  if (!info.isDirectory()) return [];

  if (await isPackageDirectory(source)) return [source];

  const entries = await readdir(source, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    const path = join(source, entry.name);
    if (entry.isFile() && isModuleFile(path)) {
      candidates.push(path);
      continue;
    }
    if (entry.isDirectory() && (await isPackageDirectory(path))) {
      candidates.push(path);
    }
  }
  return candidates.sort();
}

function readStringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${field} must be an array of strings`);
  }

  const values = value.map((item) => item.trim());
  if (values.some((item) => !item)) {
    throw new Error(`${field} must not contain empty values`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${field} must not contain duplicates`);
  }
  return values;
}

function normalizeDefinition(value: unknown): ExtensionDefinition {
  const object = asObject(value);
  if (!object || typeof object.id !== "string" || !object.id.trim()) {
    throw new Error("Extension id is required");
  }
  if (
    object.execution !== undefined &&
    !executionModes.has(object.execution as ExecutionMode)
  ) {
    throw new Error("Extension execution mode is invalid");
  }
  if (typeof object.create !== "function") {
    throw new Error("Extension create function is required");
  }

  const dependencies = readStringList(
    object.dependencies,
    "Extension dependencies",
  );
  const capabilities = readStringList(
    object.capabilities,
    "Extension capabilities",
  );
  const execution = (object.execution as ExecutionMode | undefined) ?? "child";

  return {
    id: object.id.trim(),
    execution,
    dependencies,
    capabilities,
    create: object.create as ExtensionDefinition["create"],
  };
}

function unwrapModule(value: unknown) {
  const object = asObject(value);
  return object && "default" in object ? object.default : value;
}

export function normalizeExtensionExport(
  value: unknown,
  source: string,
): { definitions: DiscoveredExtension[]; issues: DiscoveryIssue[] } {
  const exported = unwrapModule(value);
  const values = Array.isArray(exported) ? exported : [exported];
  if (values.length === 0) {
    return {
      definitions: [],
      issues: [{ source, error: "Extension export must not be empty" }],
    };
  }

  const definitions: DiscoveredExtension[] = [];
  const issues: DiscoveryIssue[] = [];
  for (const [index, item] of values.entries()) {
    const itemSource = values.length === 1 ? source : `${source}#${index}`;
    try {
      definitions.push({ definition: normalizeDefinition(item), source });
    } catch (error) {
      issues.push({ source: itemSource, error: errorMessage(error) });
    }
  }
  return { definitions, issues };
}

function defaultModuleLoader(path: string) {
  return requireModule(path) as unknown;
}

export async function discoverExtensions(
  sources: readonly string[],
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const moduleLoader = options.moduleLoader ?? defaultModuleLoader;
  const candidates = new Set<string>();
  const issues: DiscoveryIssue[] = [];

  for (const configuredSource of sources) {
    const source = resolve(expandHome(configuredSource));
    let paths: string[];
    try {
      paths = await candidatePaths(source);
    } catch (error) {
      issues.push({ source, error: errorMessage(error) });
      continue;
    }

    for (const path of paths) candidates.add(path);
  }

  const definitions: DiscoveredExtension[] = [];
  const orderedCandidates = [...candidates].sort();
  for (const source of orderedCandidates) {
    options.onCandidate?.(source);
    try {
      const value = await moduleLoader(source);
      const normalized = normalizeExtensionExport(value, source);
      definitions.push(...normalized.definitions);
      issues.push(...normalized.issues);
    } catch (error) {
      issues.push({ source, error: errorMessage(error) });
    }
  }

  return { candidates: orderedCandidates, definitions, issues };
}
