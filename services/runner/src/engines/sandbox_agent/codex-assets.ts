/**
 * Codex home assembly. Both credential modes use a runner-owned per-session home at `<cwd>/.codex`
 * (on the durable cwd mount, so native `sessions/` rollouts persist and native resume survives a
 * sandbox replacement — D-002 final ruling). SQLite state is always redirected off that home to
 * local/in-VM disk (`CODEX_SQLITE_HOME`), a hard geesefs constraint.
 *
 * MANAGED mode is FILE-FREE (D-002 final ruling): NO `auth.json` is ever written. The SDK renders a
 * custom `model_providers` block with `env_key = "OPENAI_API_KEY"` into `<cwd>/.codex/config.toml`
 * (codex_settings.py); codex reads the key from the daemon env (delivered via `plan.secrets`) at
 * request time. There is nothing to write or delete for managed auth in this module.
 *
 * SUBSCRIPTION mode still needs the operator's ChatGPT OAuth token FILE, so it SYMLINKS
 * `<cwd>/.codex/auth.json` to the operator's mounted login (`$CODEX_HOME/auth.json`); codex's
 * in-place refresh (P4) lands in the real login. The symlink is created AFTER the durable cwd mount
 * (linking before it would be shadowed) and points the runner-owned home's credential at the mount
 * while the operator's own `config.toml`/`plugins` never load.
 */

// Standing invariant: NEVER deliver Codex sandbox_mode through a CODEX_CONFIG environment JSON.
// That poison combination silently disables all approval gates. The only CODEX_CONFIG we emit is
// the subscription store-mode pin below (a single scalar key, never sandbox_mode).

import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type {
  RunPlan,
  RunPlanCredentials,
  RunPlanWorkspace,
} from "./run-plan.ts";

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
/** The slice that decides which Codex auth mode a run is in. */
type CodexModePlan = Pick<RunPlan, "acpAgent"> & {
  credentials: Pick<RunPlanCredentials, "credentialMode">;
};

/** The mode slice plus where the run's Codex home is rooted. */
type CodexHomePlan = CodexModePlan &
  Pick<RunPlan, "isDaytona"> & {
    workspace: Pick<RunPlanWorkspace, "cwd">;
  };

export function codexSqliteHomeDir(cwd: string): string {
  return join(tmpdir(), "agenta", "codex-sqlite", basename(cwd));
}

/**
 * A managed Codex run authenticates file-free from the daemon-env `OPENAI_API_KEY` via the rendered
 * custom provider (credentialMode "env" or "none"). A "runtime_provided" subscription run uses its
 * own mounted OAuth login instead, so it is excluded here.
 */
export function isManagedCodexRun(
  plan: CodexModePlan,
): boolean {
  return (
    plan.acpAgent === "codex" &&
    plan.credentials.credentialMode !== "runtime_provided"
  );
}

export function isSubscriptionCodexRun(
  plan: CodexModePlan,
): boolean {
  return (
    plan.acpAgent === "codex" &&
    plan.credentials.credentialMode === "runtime_provided"
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
  plan: CodexHomePlan,
  env: Record<string, string>,
): string | undefined {
  // Local codex only (managed or subscription). Daytona and non-codex runs are no-ops.
  if (plan.acpAgent !== "codex" || plan.isDaytona) return undefined;
  // Runner-owned per-session home in both modes. For subscription this overrides the operator's
  // mount path that buildDaemonEnv inherited into env.CODEX_HOME, so only the auth.json we symlink
  // in (see symlinkCodexSubscriptionAuthFile) is visible — not the operator's config/plugins/apps.
  env.CODEX_HOME = codexHomeDir(plan.workspace.cwd);
  // Both modes redirect SQLite off the home so neither the geesefs cwd nor the operator mount
  // accumulates per-run WAL SQLite.
  const sqliteHome = codexSqliteHomeDir(plan.workspace.cwd);
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

/**
 * A managed Daytona Codex run's in-VM CODEX_SQLITE_HOME: a sibling of the relay / tool-MCP dirs
 * (run-plan.ts), on the sandbox's own container disk, NEVER the geesefs-mounted durable cwd (SQLite
 * WAL is unsupported on geesefs — the P8 hard constraint). CODEX_HOME itself stays on the durable
 * cwd (below) so native rollouts persist. Per-session-stable via basename(cwd), like relayDir, so it
 * is not a config-fingerprint input and warm reuse is preserved.
 */
export function codexDaytonaSqliteHomeDir(cwd: string): string {
  return join("/home/sandbox/agenta", "codex-sqlite", basename(cwd));
}

/**
 * Configure a managed Daytona Codex daemon's env. The Daytona daemon env is FIXED at sandbox
 * creation (environment.ts), so these paths must be set here, before the provider is built, into the
 * env object that becomes the sandbox's `envVars` (daytonaEnvVars). CODEX_HOME is the DURABLE
 * `<cwd>/.codex` (native `sessions/` rollouts persist to the store, so native resume survives a
 * sandbox replacement — D-002 final ruling); CODEX_SQLITE_HOME is redirected off it to in-VM disk
 * (the geesefs WAL constraint). Managed auth is file-free (the SDK-rendered custom provider reads
 * OPENAI_API_KEY from this env at request time; daytonaEnvVars spreads plan.secrets), so no
 * credential file is written to the durable cwd. Subscription Daytona is rejected up front
 * (run-plan.ts); local runs and non-codex runs are no-ops.
 */
export function configureDaytonaCodexEnv(
  plan: CodexHomePlan,
  daytonaEnv: Record<string, string>,
): void {
  if (!plan.isDaytona || !isManagedCodexRun(plan)) return;
  daytonaEnv.CODEX_HOME = codexHomeDir(plan.workspace.cwd);
  daytonaEnv.CODEX_SQLITE_HOME = codexDaytonaSqliteHomeDir(plan.workspace.cwd);
}

/**
 * Symlink a subscription Codex run's auth.json in the runner-owned home (`<cwd>/.codex/auth.json`)
 * to the operator's mounted login (`$CODEX_HOME/auth.json`). Codex rewrites auth.json in place and
 * follows the symlink (P4), so a token refresh lands in the operator's real login; the runner never
 * writes or deletes the mount's file. Created only when absent (idempotent across warm/durable
 * resume), and the link is never torn down — it is a symlink to the operator's own mount, not a
 * secret, and pointing at the stable mount path is correct for the next resume. Managed runs are
 * file-free and never reach here.
 */
export function symlinkCodexSubscriptionAuthFile(
  plan: CodexHomePlan,
  log: Log = () => {},
): void {
  if (!isSubscriptionCodexRun(plan) || plan.isDaytona) return;

  const mount = codexSubscriptionMountDir();
  if (!mount) {
    log("codex subscription run has no CODEX_HOME mount; auth.json symlink not created");
    return;
  }

  const home = codexHomeDir(plan.workspace.cwd);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const linkPath = join(home, "auth.json");
  if (existsSync(linkPath)) return;

  const target = join(mount, "auth.json");
  symlinkSync(target, linkPath);
  log(`codex subscription auth.json symlinked ${linkPath} -> ${target}`);
}
