/**
 * Managed Codex credentials live in a runner-written auth.json; subscription credentials stay in
 * the operator-owned CODEX_HOME mount. Managed auth must be written AFTER the durable cwd mount is
 * applied because writing it before the mount would be shadowed. Cleanup rides session teardown:
 * the destroy backstop deletes only the managed file created for this run.
 */

// Standing invariant: NEVER deliver Codex sandbox_mode through a CODEX_CONFIG environment JSON.
// That poison combination silently disables all approval gates. Milestone 1 uses no CODEX_CONFIG.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

// The Codex home directory, relative to the session cwd; CODEX_HOME points here and both config.toml and auth.json live in it.
export const CODEX_HOME_DIRNAME = ".codex";

export function codexHomeDir(cwd: string): string {
  return join(cwd, CODEX_HOME_DIRNAME);
}

/**
 * Codex's SQLite state uses hardcoded WAL mode and must live on local container disk, never the
 * geesefs cwd mount, which cannot support WAL and caused the Milestone 1 blocker. This is an
 * ephemeral sibling of the relay and tool-MCP directories.
 *
 * The path is derived from basename(cwd), so it is per-session-stable like relayDir. It stays
 * constant across a session's turns and is NOT a config-fingerprint input, preserving warm daemon
 * reuse.
 */
export function codexSqliteHomeDir(cwd: string): string {
  return join(tmpdir(), "agenta", "codex-sqlite", basename(cwd));
}

/**
 * A managed Codex run authenticates from a runner-written auth.json (credentialMode "env" or
 * "none"). A "runtime_provided" subscription run owns its login mount, so managed auth writing
 * must exclude it.
 */
export function isManagedCodexRun(
  plan: Pick<RunPlan, "acpAgent" | "credentialMode">,
): boolean {
  return (
    plan.acpAgent === "codex" && plan.credentialMode !== "runtime_provided"
  );
}

export function isSubscriptionCodexRun(
  plan: Pick<RunPlan, "acpAgent" | "credentialMode">,
): boolean {
  return (
    plan.acpAgent === "codex" && plan.credentialMode === "runtime_provided"
  );
}

/**
 * Configure local Codex home state before the daemon starts. Managed runs use a runner-owned home;
 * subscription runs keep the inherited operator mount. Both redirect SQLite to local disk and
 * return that directory for best-effort teardown cleanup.
 */
export function configureCodexHome(
  plan: Pick<RunPlan, "acpAgent" | "credentialMode" | "isDaytona" | "cwd">,
  env: Record<string, string>,
): string | undefined {
  // Local codex only (managed or subscription). Daytona and non-codex runs are no-ops.
  if (plan.acpAgent !== "codex" || plan.isDaytona) return undefined;
  // Managed homes are runner-owned; subscription keeps the inherited operator mount so token
  // refresh lands in the real login.
  if (isManagedCodexRun(plan)) {
    env.CODEX_HOME = codexHomeDir(plan.cwd);
  }
  // Both modes redirect SQLite off the home so neither geesefs nor the operator mount accumulates
  // per-run WAL SQLite.
  const sqliteHome = codexSqliteHomeDir(plan.cwd);
  mkdirSync(sqliteHome, { recursive: true });
  env.CODEX_SQLITE_HOME = sqliteHome;
  return sqliteHome;
}

export interface WriteCodexAuthResult {
  /**
   * The file this run created. Undefined means there is nothing for the caller to delete, so a
   * pre-existing login is never removed.
   */
  authFilePath: string | undefined;
}

/**
 * Write a local managed Codex run's auth.json after the durable cwd mount is applied. The file is
 * created only when absent and returned only when this run created it, so teardown never deletes
 * a pre-existing login.
 */
export function writeCodexManagedAuthFile(
  plan: Pick<
    RunPlan,
    | "acpAgent"
    | "credentialMode"
    | "isDaytona"
    | "cwd"
    | "secrets"
    | "legacyHarnessApiKeyVar"
  >,
  log: Log = () => {},
): WriteCodexAuthResult {
  if (!isManagedCodexRun(plan) || plan.isDaytona) {
    return { authFilePath: undefined };
  }

  const home = codexHomeDir(plan.cwd);
  const key = plan.secrets[plan.legacyHarnessApiKeyVar];
  if (!key) {
    log(
      `codex managed run has no resolved API key under ${plan.legacyHarnessApiKeyVar}; ` +
        "auth.json not written",
    );
    return { authFilePath: undefined };
  }

  mkdirSync(home, { recursive: true, mode: 0o700 });
  const authFile = join(home, "auth.json");
  if (existsSync(authFile)) return { authFilePath: undefined };

  // The auth.json field is always OPENAI_API_KEY regardless of the source variable.
  writeFileSync(authFile, JSON.stringify({ OPENAI_API_KEY: key }), {
    encoding: "utf-8",
    mode: 0o600,
  });
  log(`codex auth.json written home=${home}`);
  return { authFilePath: authFile };
}
