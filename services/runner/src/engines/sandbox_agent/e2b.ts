import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  uploadPiExtensionToSandbox,
  uploadSkillsToSandbox,
  uploadSystemPromptToSandbox,
} from "./pi-assets.ts";
import { shouldUploadOwnLogin, type RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

/** In-sandbox Pi agent dir (daemon runs as root in the E2B template). */
export const E2B_PI_DIR =
  process.env.AGENTA_AGENT_SANDBOX_PI_DIR ?? "/root/.pi/agent";

/** In-sandbox codex auth dir (E2B runs as root). */
export const E2B_CODEX_DIR =
  process.env.AGENTA_AGENT_SANDBOX_CODEX_DIR ?? "/root/.codex";

/**
 * In-sandbox env for the E2B daemon: provider keys + Agenta extension env so the remote
 * agent traces and runs tools exactly like local.
 */
export function e2bEnvVars(
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  return {
    PI_CODING_AGENT_DIR: E2B_PI_DIR,
    ...piExtEnv,
    ...secrets,
  };
}

/**
 * Upload Pi's fallback `auth.json` into an E2B sandbox. Best-effort.
 */
export async function uploadPiAuthToE2BSandbox(
  sandbox: any,
  log: Log = () => {},
): Promise<void> {
  const localDir =
    process.env.PI_CODING_AGENT_DIR || join(process.env.HOME ?? "", ".pi/agent");
  const authPath = join(localDir, "auth.json");
  if (!existsSync(authPath)) return;
  try {
    await sandbox.mkdirFs({ path: E2B_PI_DIR });
    await sandbox.writeFsFile(
      { path: `${E2B_PI_DIR}/auth.json` },
      readFileSync(authPath, "utf-8"),
    );
    const settingsPath = join(localDir, "settings.json");
    if (existsSync(settingsPath)) {
      await sandbox.writeFsFile(
        { path: `${E2B_PI_DIR}/settings.json` },
        readFileSync(settingsPath, "utf-8"),
      );
    }
  } catch (err) {
    log(`pi auth upload skipped: ${(err as Error).message}`);
  }
}

/**
 * Write the codex auth file into an E2B sandbox.
 *
 * Managed mode: the resolved `apiKey` is written as `{"OPENAI_API_KEY":"..."}`.
 * Self-managed mode: pass `undefined` and the local `~/.codex/auth.json` is uploaded verbatim.
 * Best-effort: failures are logged but do not abort the run.
 */
export async function uploadCodexAuthToE2BSandbox(
  sandbox: any,
  apiKey: string | undefined,
  log: Log = () => {},
): Promise<void> {
  try {
    await sandbox.mkdirFs({ path: E2B_CODEX_DIR });
    if (apiKey) {
      await sandbox.writeFsFile(
        { path: `${E2B_CODEX_DIR}/auth.json` },
        JSON.stringify({ OPENAI_API_KEY: apiKey }),
      );
      return;
    }
    const localAuth = join(homedir(), ".codex", "auth.json");
    if (existsSync(localAuth)) {
      await sandbox.writeFsFile(
        { path: `${E2B_CODEX_DIR}/auth.json` },
        readFileSync(localAuth, "utf-8"),
      );
    }
  } catch (err) {
    log(`codex auth.json upload skipped: ${(err as Error).message}`);
  }
}

export interface PrepareE2BCodexAssetsInput {
  sandbox: any;
  plan: Pick<RunPlan, "acpAgent" | "hasApiKey" | "credentialMode" | "secrets">;
  log?: Log;
}

/**
 * Push codex credentials into an E2B sandbox.
 *
 * Managed (`credentialMode="env"`): writes `auth.json` from the resolved `OPENAI_API_KEY ?? CODEX_API_KEY`.
 * Self-managed (`runtime_provided`): uploads the runner's own `~/.codex/auth.json`.
 * Returns immediately for non-codex runs.
 */
export async function prepareE2BCodexAssets({
  sandbox,
  plan,
  log = () => {},
}: PrepareE2BCodexAssetsInput): Promise<void> {
  if (plan.acpAgent !== "codex") return;

  const resolvedKey = plan.secrets.OPENAI_API_KEY ?? plan.secrets.CODEX_API_KEY;
  if (plan.credentialMode === "env" && resolvedKey) {
    await uploadCodexAuthToE2BSandbox(sandbox, resolvedKey, log);
    return;
  }
  if (shouldUploadOwnLogin(plan)) {
    await uploadCodexAuthToE2BSandbox(sandbox, undefined, log);
  }
}

export interface PrepareE2BPiAssetsInput {
  sandbox: any;
  plan: Pick<
    RunPlan,
    | "isPi"
    | "hasApiKey"
    | "credentialMode"
    | "skillDirs"
    | "hasSystemPrompt"
    | "systemPrompt"
    | "appendSystemPrompt"
  >;
  log?: Log;
}

/**
 * Push the Pi login fallback, Agenta extension, forced skills, and system prompts into an
 * E2B sandbox. Pi is baked into the template — no in-sandbox install needed.
 */
export async function prepareE2BPiAssets({
  sandbox,
  plan,
  log = () => {},
}: PrepareE2BPiAssetsInput): Promise<void> {
  if (!plan.isPi) return;

  if (shouldUploadOwnLogin(plan)) await uploadPiAuthToE2BSandbox(sandbox, log);
  await uploadPiExtensionToSandbox(sandbox, E2B_PI_DIR, log);
  if (plan.skillDirs.length > 0) {
    await uploadSkillsToSandbox(sandbox, E2B_PI_DIR, plan.skillDirs, log);
  }
  if (plan.hasSystemPrompt) {
    await uploadSystemPromptToSandbox(
      sandbox,
      E2B_PI_DIR,
      plan.systemPrompt,
      plan.appendSystemPrompt,
      log,
    );
  }
}
