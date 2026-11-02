/**
 * Read-only access to Pi's BUILT-IN model catalog.
 *
 * This is the table the Pi harness itself enumerates when it answers "which models may this
 * session select": `pi-acp` advertises `<provider>/<id>` for every model the registry holds, and a
 * `setModel` for anything outside it fails with `UnsupportedSessionValueError`. The runner needs
 * the same table to answer one question before the harness starts — is the requested model already
 * known to Pi, or does it have to be REGISTERED for this run (`pi-model-config.ts`)?
 *
 * The catalog is `@earendil-works/pi-ai`, which is NOT a dependency of this package and
 * deliberately so: it is a dependency of `@earendil-works/pi-coding-agent`, the harness itself, and
 * resolving it through that installation means the table read here is by construction the table the
 * harness runs. A second top-level pin could drift from the harness's own copy and would then have
 * the runner deciding "built-in" against a catalog Pi does not have.
 *
 * That resolution is done by path rather than by package specifier, in the spirit of
 * `resolveDaemonBinary` in `daemon.ts`: `pi-ai` exposes only an `import` condition in its exports
 * map, so `createRequire().resolve` cannot see it, and it is not a direct dependency, so a bare
 * specifier import does not resolve either. Importing the file path bypasses both problems and
 * covers the pnpm scope-sibling layout the runner image ships as well as npm's nested and hoisted
 * layouts.
 *
 * The import is LAZY and cached: the catalog is a few megabytes of generated model definitions, and
 * a deployment that only ever runs Claude or Codex should not pay for parsing it. A failure is
 * cached too and reported as "no registry", which the caller treats as "register nothing" (today's
 * behavior) rather than guessing.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { PKG_ROOT } from "./daemon.ts";

/** The subset of a Pi model definition this runner reads. */
export interface PiBuiltinModel {
  id: string;
  name?: string;
  api?: string;
  provider?: string;
  baseUrl?: string;
  compat?: Record<string, unknown>;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  cost?: Record<string, unknown>;
  contextWindow?: number;
  maxTokens?: number;
}

export interface PiBuiltinRegistry {
  /** True when `provider` is one of Pi's own built-in provider ids (e.g. `openrouter`). */
  hasProvider(provider: string): boolean;
  /** Every built-in model Pi ships for `provider`; empty for an unknown provider. */
  models(provider: string): PiBuiltinModel[];
}

/** The catalog module's shape. Hand-declared: the module is imported by path, so it is untyped. */
interface PiCatalogModule {
  getBuiltinProviders(): string[];
  getBuiltinModels(provider: string): PiBuiltinModel[];
}

type Log = (message: string) => void;

/** `@earendil-works/pi-ai`'s static catalog entrypoint, relative to that package's root. */
const CATALOG_SUBPATH = join("dist", "providers", "all.js");

/**
 * Where `pi-ai` can sit relative to the installed harness package. `realpathSync` first resolves
 * the `pi-coding-agent` symlink into pnpm's content-addressed store, so its `@earendil-works`
 * scope directory is the one holding the exact `pi-ai` that harness depends on.
 */
function piCatalogCandidates(): string[] {
  const candidates: string[] = [];
  const runnerScope = join(PKG_ROOT, "node_modules", "@earendil-works");
  const harness = join(runnerScope, "pi-coding-agent");

  try {
    // pnpm: .../.pnpm/<harness>/node_modules/@earendil-works/{pi-coding-agent,pi-ai}
    const scope = dirname(realpathSync(harness));
    candidates.push(join(scope, "pi-ai", CATALOG_SUBPATH));
    // npm nested: the harness carries its own node_modules tree.
    candidates.push(
      join(
        scope,
        "pi-coding-agent",
        "node_modules",
        "@earendil-works",
        "pi-ai",
        CATALOG_SUBPATH,
      ),
    );
  } catch {
    // The harness package is not installed where expected; the layouts below may still hold.
  }
  // npm hoisted (and the case where pi-ai is installed at the top level in its own right).
  candidates.push(join(runnerScope, "pi-ai", CATALOG_SUBPATH));
  return candidates;
}

let cached: Promise<PiBuiltinRegistry | undefined> | undefined;

async function importPiBuiltinRegistry(
  log: Log,
): Promise<PiBuiltinRegistry | undefined> {
  const path = piCatalogCandidates().find((candidate) => existsSync(candidate));
  if (!path) {
    log(
      "pi built-in model catalog not found next to the installed pi-coding-agent; " +
        "no model will be registered for this run",
    );
    return undefined;
  }
  try {
    const catalog: PiCatalogModule = await import(pathToFileURL(path).href);
    const providers = new Set(catalog.getBuiltinProviders() ?? []);
    return {
      hasProvider: (provider) => providers.has(provider),
      models: (provider) =>
        providers.has(provider)
          ? (catalog.getBuiltinModels(provider) ?? [])
          : [],
    };
  } catch (err) {
    // Not terminal: the caller keeps today's behavior (no model is registered) rather than
    // registering blindly, which would overwrite a built-in model's own definition.
    log(
      `pi built-in model catalog at ${path} could not be read: ${(err as Error).message}`,
    );
    return undefined;
  }
}

/** Load (once) Pi's built-in catalog, or `undefined` when it cannot be read. */
export function loadPiBuiltinRegistry(
  log: Log = () => {},
): Promise<PiBuiltinRegistry | undefined> {
  cached ??= importPiBuiltinRegistry(log);
  return cached;
}
