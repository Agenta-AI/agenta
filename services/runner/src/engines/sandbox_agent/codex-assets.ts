/**
 * Codex home assembly. Both credential modes use a runner-owned per-session home at `<cwd>/.codex`,
 * so a product session never loads the operator's personal `config.toml`/`plugins`/`apps` (item C,
 * the D-002 symlink-assembly amendment). Managed mode writes `auth.json` into that home from the
 * resolved vault key; subscription mode SYMLINKS `auth.json` there to the operator's mounted login
 * (`$CODEX_HOME/auth.json`), so codex's in-place refresh (P4) still lands in the real login. The
 * auth file (or symlink) is created AFTER the durable cwd mount (writing before it would be
 * shadowed); teardown removes only what this run created — the managed file, or the symlink LINK,
 * never the mount target.
 */

// Standing invariant: NEVER deliver Codex sandbox_mode through a CODEX_CONFIG environment JSON.
// That poison combination silently disables all approval gates. The only CODEX_CONFIG we emit is
// the subscription store-mode pin below (a single scalar key, never sandbox_mode).

import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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
 * The operator's mounted Codex login dir for a subscription run: the value of the daemon's
 * inherited `CODEX_HOME` env (set by the operator, e.g. `/codex-home`), captured from `process.env`
 * because `configureCodexHome` overrides the daemon `env.CODEX_HOME` to the runner-owned home.
 * `run-plan` already rejected a subscription run whose mount var is unset.
 */
function codexSubscriptionMountDir(): string | undefined {
  return process.env.CODEX_HOME || undefined;
}

/**
 * Configure local Codex home state before the daemon starts. BOTH modes point `CODEX_HOME` at the
 * runner-owned `<cwd>/.codex` (subscription overrides the inherited mount path so the operator's
 * config never loads). Both redirect SQLite off the home to local disk and return that directory
 * for best-effort teardown cleanup. Subscription additionally pins the credential store to `file`.
 */
export function configureCodexHome(
  plan: Pick<RunPlan, "acpAgent" | "credentialMode" | "isDaytona" | "cwd">,
  env: Record<string, string>,
): string | undefined {
  // Local codex only (managed or subscription). Daytona and non-codex runs are no-ops.
  if (plan.acpAgent !== "codex" || plan.isDaytona) return undefined;
  // Runner-owned per-session home in both modes. For subscription this overrides the operator's
  // mount path that buildDaemonEnv inherited into env.CODEX_HOME, so only the auth.json we symlink
  // in (see symlinkCodexSubscriptionAuthFile) is visible — not the operator's config/plugins/apps.
  env.CODEX_HOME = codexHomeDir(plan.cwd);
  // Both modes redirect SQLite off the home so neither the geesefs cwd nor the operator mount
  // accumulates per-run WAL SQLite.
  const sqliteHome = codexSqliteHomeDir(plan.cwd);
  mkdirSync(sqliteHome, { recursive: true });
  env.CODEX_SQLITE_HOME = sqliteHome;
  // Subscription: pin the credential store to `file` so a keyring/auto mode (from any config layer)
  // can never delete the symlinked auth.json. A single scalar key — NEVER sandbox_mode (D-008
  // poison combo). Constant per subscription codex run and gated on credentialMode, a
  // configFingerprint input, so warm-daemon delivery stays per-run-correct (P1).
  if (isSubscriptionCodexRun(plan)) {
    env.CODEX_CONFIG = JSON.stringify({ cli_auth_credentials_store: "file" });
  }
  return sqliteHome;
}

// The in-VM Daytona base for Codex home + SQLite state: a sibling of the relay / tool-MCP dirs
// (run-plan.ts), always on the sandbox's own container disk, NEVER the geesefs-mounted durable cwd.
// Managed Daytona keeps the resolved key OFF durable storage this way (see codexDaytonaHomeDir).
const DAYTONA_CODEX_BASE = "/home/sandbox/agenta";

/**
 * A managed Daytona Codex run's CODEX_HOME, in the sandbox VM (not the durable cwd). auth.json holds
 * the resolved key, so it must never land on the geesefs-mounted cwd, which is durable S3 storage:
 * the destroy path pauses or destroys the sandbox before any per-run file backstop could delete it
 * (environment.ts), so a key on the durable cwd could outlive the run. An in-VM home is reaped with
 * the sandbox and is reliably deleted at session end by construction — the strongest form of the
 * D-002 "reliably delete the key at session end" requirement (amendment recorded in decisions.md).
 * An authored `.codex/config.toml` still applies: prepareWorkspace writes it under the cwd and codex
 * reads it as the workspace config layer (D-007), independent of CODEX_HOME. Per-session-stable via
 * basename(cwd), like relayDir, so it is not a config-fingerprint input and warm reuse is preserved.
 */
export function codexDaytonaHomeDir(cwd: string): string {
  return join(DAYTONA_CODEX_BASE, "codex-home", basename(cwd));
}

/** A managed Daytona Codex run's in-VM CODEX_SQLITE_HOME (off the geesefs mount, per the P8 lesson). */
export function codexDaytonaSqliteHomeDir(cwd: string): string {
  return join(DAYTONA_CODEX_BASE, "codex-sqlite", basename(cwd));
}

/**
 * Configure a managed Daytona Codex daemon's env. The Daytona daemon env is FIXED at sandbox
 * creation (environment.ts), so these paths must be set here, before the provider is built, into the
 * env object that becomes the sandbox's `envVars` (daytonaEnvVars). CODEX_HOME and CODEX_SQLITE_HOME
 * both point at in-VM paths so no credential and no WAL SQLite ever touch the durable cwd. Subscription
 * Daytona is rejected up front (run-plan.ts); local runs and non-codex runs are no-ops.
 */
export function configureDaytonaCodexEnv(
  plan: Pick<RunPlan, "acpAgent" | "credentialMode" | "isDaytona" | "cwd">,
  daytonaEnv: Record<string, string>,
): void {
  if (!plan.isDaytona || !isManagedCodexRun(plan)) return;
  daytonaEnv.CODEX_HOME = codexDaytonaHomeDir(plan.cwd);
  daytonaEnv.CODEX_SQLITE_HOME = codexDaytonaSqliteHomeDir(plan.cwd);
}

/**
 * Write a managed Daytona Codex run's auth.json into the in-VM CODEX_HOME after the sandbox starts.
 * Uses the sandbox filesystem API (the file lives in the remote VM, not on the runner host). Written
 * every acquire (idempotent): a fresh VM has no file, and a warm-reused VM is refreshed to the current
 * key. The dir is in-VM and reaped with the sandbox, so no cross-mount teardown delete is needed.
 *
 * INVARIANT (Daytona-Secrets #5277 compat): the key value is written OPAQUELY. Under the placeholder
 * design the runner receives a placeholder here, not the real key, and Daytona's egress proxy
 * substitutes it in flight; P3 proved codex copies the credential byte-exact into request headers with
 * no client-side validation, so this writer must never inspect, parse, or reformat the string.
 */
export async function writeCodexDaytonaManagedAuthFile(
  sandbox: {
    mkdirFs: (arg: { path: string }) => Promise<unknown>;
    writeFsFile: (arg: { path: string }, contents: string) => Promise<unknown>;
  },
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
): Promise<void> {
  if (!plan.isDaytona || !isManagedCodexRun(plan)) return;

  const key = plan.secrets[plan.legacyHarnessApiKeyVar];
  if (!key) {
    log(
      `codex managed Daytona run has no resolved API key under ${plan.legacyHarnessApiKeyVar}; ` +
        "auth.json not written",
    );
    return;
  }

  const home = codexDaytonaHomeDir(plan.cwd);
  await sandbox.mkdirFs({ path: home });
  // The auth.json field is always OPENAI_API_KEY regardless of the source variable.
  await sandbox.writeFsFile(
    { path: join(home, "auth.json") },
    JSON.stringify({ OPENAI_API_KEY: key }),
  );
  log(`codex auth.json written (Daytona, in-VM) home=${home}`);
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

/**
 * Symlink a subscription Codex run's auth.json in the runner-owned home (`<cwd>/.codex/auth.json`)
 * to the operator's mounted login (`$CODEX_HOME/auth.json`). Codex rewrites auth.json in place and
 * follows the symlink (P4), so a token refresh lands in the operator's real login; the runner never
 * writes or deletes the mount's file. Created only when absent and returned only when this run
 * created the LINK, so teardown removes the link (not its target) with delete-only-if-created.
 */
export function symlinkCodexSubscriptionAuthFile(
  plan: Pick<RunPlan, "acpAgent" | "credentialMode" | "isDaytona" | "cwd">,
  log: Log = () => {},
): WriteCodexAuthResult {
  if (!isSubscriptionCodexRun(plan) || plan.isDaytona) {
    return { authFilePath: undefined };
  }

  const mount = codexSubscriptionMountDir();
  if (!mount) {
    log("codex subscription run has no CODEX_HOME mount; auth.json symlink not created");
    return { authFilePath: undefined };
  }

  const home = codexHomeDir(plan.cwd);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const linkPath = join(home, "auth.json");
  if (existsSync(linkPath)) return { authFilePath: undefined };

  const target = join(mount, "auth.json");
  symlinkSync(target, linkPath);
  log(`codex subscription auth.json symlinked ${linkPath} -> ${target}`);
  return { authFilePath: linkPath };
}
