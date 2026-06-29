import { existsSync, readFileSync } from "node:fs";
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

/**
 * In-sandbox env for the E2B daemon: provider keys + Agenta extension env so the remote
 * Pi traces and runs tools exactly like local. Pi is baked into the template so no
 * PI_ACP_PI_COMMAND override is needed.
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
export async function uploadPiAuthToE2bSandbox(
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

export interface PrepareE2bPiAssetsInput {
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
export async function prepareE2bPiAssets({
  sandbox,
  plan,
  log = () => {},
}: PrepareE2bPiAssetsInput): Promise<void> {
  if (!plan.isPi) return;

  if (shouldUploadOwnLogin(plan)) await uploadPiAuthToE2bSandbox(sandbox, log);
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
