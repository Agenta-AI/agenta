import { chmodSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// services/agent/src/engines/sandbox_agent/daemon.ts -> services/agent
export const PKG_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
export const ADAPTER_BIN_DIR = join(PKG_ROOT, "node_modules", ".bin");

/** Map node platform/arch to the @sandbox-agent CLI binary package. */
const CLI_PACKAGES: Record<string, string> = {
  "darwin-arm64": "@sandbox-agent/cli-darwin-arm64",
  "darwin-x64": "@sandbox-agent/cli-darwin-x64",
  "linux-x64": "@sandbox-agent/cli-linux-x64",
  "linux-arm64": "@sandbox-agent/cli-linux-arm64",
  "win32-x64": "@sandbox-agent/cli-win32-x64",
};

/**
 * Resolve the sandbox-agent daemon binary. Prefers SANDBOX_AGENT_BIN, then the platform
 * CLI package shipped with `sandbox-agent`, then a pnpm store scan.
 */
export function resolveDaemonBinary(): string | undefined {
  const fromEnv = process.env.SANDBOX_AGENT_BIN;
  if (fromEnv && existsSync(fromEnv)) return ensureExecutable(fromEnv);

  const pkg = CLI_PACKAGES[`${process.platform}-${process.arch}`];
  if (!pkg) return undefined;
  const bin = process.platform === "win32" ? "sandbox-agent.exe" : "sandbox-agent";
  try {
    const sdkRequire = createRequire(require.resolve("sandbox-agent"));
    const pkgJson = sdkRequire.resolve(`${pkg}/package.json`);
    const resolved = join(dirname(pkgJson), "bin", bin);
    if (existsSync(resolved)) return ensureExecutable(resolved);
  } catch {
    // fall through to a store scan
  }
  try {
    const store = join(PKG_ROOT, "node_modules", ".pnpm");
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith(`@sandbox-agent+cli-${process.platform}`)) continue;
      const candidate = join(store, entry, "node_modules", pkg, "bin", bin);
      if (existsSync(candidate)) return ensureExecutable(candidate);
    }
  } catch {
    // store not present
  }
  return undefined;
}

function ensureExecutable(path: string): string {
  try {
    chmodSync(path, 0o755);
  } catch {
    // read-only fs (for example, a baked snapshot already +x): ignore
  }
  return path;
}

/**
 * Every provider/auth env var a run might carry. The clear-then-apply discipline (Security
 * rule 5 in the provider-model-auth design) clears this whole set so an inherited key for one
 * provider cannot leak into a run that resolved a different provider's key. Mirrors the Python
 * `_PROVIDER_ENV_VARS` values plus the OAuth / auth-token vars the harnesses read.
 */
export const KNOWN_PROVIDER_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "TOGETHERAI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export interface BuildDaemonEnvOptions {
  /**
   * Clear-then-apply (Security rule 5): on a MANAGED run (`credentialMode === "env"`) the
   * resolved `secrets` are the sole authority, so the daemon must NOT inherit the sidecar's own
   * provider keys (the caller applies only `plan.secrets`). When true, no `KNOWN_PROVIDER_ENV_VARS`
   * are copied. When false (a `runtime_provided` / `none` run), the daemon keeps the inherited
   * provider/auth keys so the harness's own login still works.
   */
  clearProviderEnv?: boolean;
}

/**
 * Environment the local daemon is born with. This intentionally copies only runner/harness
 * launch variables and (for non-managed runs) known provider auth, not the full sidecar
 * environment.
 *
 * Clear-then-apply (Security rule 5 in the provider-model-auth design): on a managed run
 * (`clearProviderEnv`) this copies NONE of `KNOWN_PROVIDER_ENV_VARS`, so the only provider env
 * the daemon ever sees is what the caller applies from `plan.secrets`. An inherited
 * `ANTHROPIC_API_KEY` can therefore not leak into a resolved OpenAI run. For a `runtime_provided`
 * / `none` run the harness uses its own login, so the inherited keys are kept.
 */
export function buildDaemonEnv(
  _harness: string,
  { clearProviderEnv = false }: BuildDaemonEnvOptions = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  const extra = process.env.SANDBOX_AGENT_ADAPTER_PATH;
  env.PATH = [ADAPTER_BIN_DIR, extra, process.env.PATH].filter(Boolean).join(":");

  env.PI_ACP_PI_COMMAND =
    process.env.SANDBOX_AGENT_PI_COMMAND ?? join(ADAPTER_BIN_DIR, "pi");
  const piAgentDir = process.env.PI_CODING_AGENT_DIR;
  if (piAgentDir) env.PI_CODING_AGENT_DIR = piAgentDir;
  // CLAUDE_CONFIG_DIR is a config path, not a credential; it is safe to inherit on every run so
  // a self-managed Claude login keeps pointing at its config dir.
  if (process.env.CLAUDE_CONFIG_DIR)
    env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

  if (process.env.HOME) env.HOME = process.env.HOME;

  // Managed run: clear (inherit no provider keys); the caller applies only the resolved
  // `plan.secrets`. Non-managed run: keep the sidecar's own keys so its login works.
  if (!clearProviderEnv) {
    for (const key of KNOWN_PROVIDER_ENV_VARS) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
  }

  return env;
}
