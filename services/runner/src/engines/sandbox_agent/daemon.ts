import { chmodSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// services/runner/src/engines/sandbox_agent/daemon.ts -> services/runner
export const PKG_ROOT = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);
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
  const bin =
    process.platform === "win32" ? "sandbox-agent.exe" : "sandbox-agent";
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
 * The COMPLETE provider/auth env inventory a run might carry — the *clear* set for the
 * clear-then-apply discipline (Security rule 5 in the provider-model-auth design). On a managed
 * run the daemon clears EVERY entry here so no inherited credential leaks in, then the caller
 * applies the resolver's `env` (the *apply* set, which is different — only what this connection
 * needs). The clear set must therefore be a superset: every direct-provider `*_API_KEY`, every
 * OAuth / auth-token var the harnesses read, AND the full cloud groups (AWS for Bedrock, GCP/ADC
 * for Vertex, Azure). Clearing only the resolver's `env` would leave inherited cloud creds alive,
 * which is exactly the leak this guards. Keep the direct-key entries in agreement with the Python
 * `_PROVIDER_ENV_VARS` / SDK `capabilities.py`, and the cloud groups with the API
 * `_CLOUD_SECRET_ENV_BY_DEPLOYMENT`.
 */
export const KNOWN_PROVIDER_ENV_VARS = [
  // Direct provider api keys (the eight vault-mapped Pi providers + the legacy aliases).
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "MINIMAX_API_KEY",
  "GROQ_API_KEY",
  "TOGETHERAI_API_KEY",
  "TOGETHER_API_KEY",
  "OPENROUTER_API_KEY",
  // Anthropic / Claude auth tokens and OAuth.
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_CUSTOM_MODEL_OPTION",
  "ANTHROPIC_BASE_URL",
  // Bedrock (AWS) credential group + the Claude-on-Bedrock flag.
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "CLAUDE_CODE_USE_BEDROCK",
  // Vertex (GCP) credential group + the Claude-on-Vertex flag.
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "CLAUDE_CODE_USE_VERTEX",
  // Azure OpenAI.
  "AZURE_OPENAI_API_KEY",
] as const;

// Sandbox-provider infra creds (never a harness concern): cleared on EVERY run, not just managed
// ones. sandbox-agent's local() spawns `{...process.env, ...options.env}` (inherit-then-apply), so
// an absent key here doesn't stop the leak — must be forced to "" to override the inherited value.
export const KNOWN_SANDBOX_ENV_VARS = [
  // The operator sets the runner's Daytona credential under this name; the runner also bridges it
  // into the ambient `DAYTONA_API_KEY` the vendored SDK reads. Blank BOTH so neither reaches a
  // local harness process.
  "AGENTA_RUNNER_DAYTONA_API_KEY",
  "DAYTONA_API_KEY",
  "E2B_API_KEY",
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
  env.PATH = [ADAPTER_BIN_DIR, extra, process.env.PATH]
    .filter(Boolean)
    .join(":");

  env.PI_ACP_PI_COMMAND =
    process.env.SANDBOX_AGENT_PI_COMMAND ?? join(ADAPTER_BIN_DIR, "pi");
  const piAgentDir = process.env.PI_CODING_AGENT_DIR;
  if (piAgentDir) env.PI_CODING_AGENT_DIR = piAgentDir;
  // CLAUDE_CONFIG_DIR is a config path, not a credential; it is safe to inherit on every run so
  // a self-managed Claude login keeps pointing at its config dir.
  if (process.env.CLAUDE_CONFIG_DIR)
    env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

  if (process.env.HOME) env.HOME = process.env.HOME;

  // Force-blank sandbox infra creds on every run (see KNOWN_SANDBOX_ENV_VARS doc): the underlying
  // spawn inherits process.env first, so an absent key here would NOT stop the leak.
  for (const key of KNOWN_SANDBOX_ENV_VARS) env[key] = "";

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
