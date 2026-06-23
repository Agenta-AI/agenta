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
 * Environment the local daemon is born with. This intentionally copies only runner/harness
 * launch variables and known provider auth, not the full sidecar environment.
 */
export function buildDaemonEnv(_harness: string): Record<string, string> {
  const env: Record<string, string> = {};

  const extra = process.env.SANDBOX_AGENT_ADAPTER_PATH;
  env.PATH = [ADAPTER_BIN_DIR, extra, process.env.PATH].filter(Boolean).join(":");

  env.PI_ACP_PI_COMMAND =
    process.env.SANDBOX_AGENT_PI_COMMAND ?? join(ADAPTER_BIN_DIR, "pi");
  const piAgentDir = process.env.PI_CODING_AGENT_DIR;
  if (piAgentDir) env.PI_CODING_AGENT_DIR = piAgentDir;

  if (process.env.HOME) env.HOME = process.env.HOME;

  for (const key of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CONFIG_DIR",
    "GEMINI_API_KEY",
  ]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }

  return env;
}
