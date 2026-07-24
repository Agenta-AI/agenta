/**
 * Codex managed credentials live in a runner-written auth.json. The file must be written AFTER
 * the durable cwd mount is applied because writing it before the mount would be shadowed. Unlike
 * pi-assets, this step is invoked from the post-mount workspace step. Cleanup rides session
 * teardown: the caller's destroy backstop deletes only the file created for this run, mirroring
 * the otlpAuthFilePath pattern.
 */

// Standing invariant: NEVER deliver Codex sandbox_mode through a CODEX_CONFIG environment JSON.
// That poison combination silently disables all approval gates. Milestone 1 uses no CODEX_CONFIG.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

// The Codex home directory, relative to the session cwd; CODEX_HOME points here and both config.toml and auth.json live in it.
export const CODEX_HOME_DIRNAME = ".codex";

export function codexHomeDir(cwd: string): string {
  return join(cwd, CODEX_HOME_DIRNAME);
}

/**
 * A managed Codex run authenticates from a runner-written auth.json (credentialMode "env" or
 * "none"). A "runtime_provided" (subscription) run owns its own login mount and is rejected in
 * Milestone 1 (see run-plan.ts), so it is excluded here.
 */
export function isManagedCodexRun(
  plan: Pick<RunPlan, "acpAgent" | "credentialMode">,
): boolean {
  return (
    plan.acpAgent === "codex" && plan.credentialMode !== "runtime_provided"
  );
}

/**
 * Set only the CODEX_HOME path, which is safe before the durable cwd mount is applied. The
 * auth.json file itself is written later, after the mount, by writeCodexManagedAuthFile.
 * Daytona managed Codex is a later milestone.
 */
export function configureCodexHome(
  plan: Pick<RunPlan, "acpAgent" | "credentialMode" | "isDaytona" | "cwd">,
  env: Record<string, string>,
): string | undefined {
  if (!isManagedCodexRun(plan) || plan.isDaytona) return undefined;
  const home = codexHomeDir(plan.cwd);
  env.CODEX_HOME = home;
  return home;
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
