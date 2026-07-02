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
 * Per-harness "already baked" levers, mirroring `AGENTA_AGENT_SANDBOX_PI_INSTALLED`.
 *
 * Pi's lever works by skipping a RUNNER-side step (`installPiInSandbox` in daytona.ts): Pi is
 * never one of the daemon's `install-agent` targets, so the runner is the only thing that can
 * decide to install it, and the env var gates that call directly.
 *
 * Codex, opencode, and claude are different: the `sandbox-agent/e2b` provider's `create()`
 * unconditionally shells `sandbox-agent install-agent <agent>` for claude/codex on every E2B
 * sandbox (opencode is not even in its `DEFAULT_AGENTS` list, so it is never daemon-installed
 * today). That call happens inside the `sandbox-agent` npm package the runner imports, before
 * the runner sees the sandbox — there is no hook in `SandboxProvider`/`E2BProviderOptions` for
 * the runner to skip it, and no env var the daemon itself reads to no-op the call. So these
 * three levers do NOT reach a daemon skip flag the way Pi's does.
 *
 * What they document instead: the e2b.Dockerfile bakes each harness's ACP adapter + native CLI
 * at the exact paths `sandbox-agent install-agent <id>` would have used
 * (`~/.local/share/sandbox-agent/bin/agent_processes/<id>`), and the daemon's own installer
 * checks for an existing install before doing any work (`agent_manager.install_agent_process:
 * already installed`, observed in the compiled daemon binary). So a baked template still turns
 * every `install-agent` call into a fast no-op — the win is real, it just happens inside the
 * daemon's own idempotency check rather than a runner-side skip. These constants exist so a
 * baked custom template can flip the default to document that; they intentionally do not gate
 * any runner behavior (there is none to gate).
 */
export const E2B_CODEX_INSTALLED =
  process.env.AGENTA_AGENT_SANDBOX_CODEX_INSTALLED !== "false";
export const E2B_OPENCODE_INSTALLED =
  process.env.AGENTA_AGENT_SANDBOX_OPENCODE_INSTALLED !== "false";
export const E2B_CLAUDE_INSTALLED =
  process.env.AGENTA_AGENT_SANDBOX_CLAUDE_INSTALLED !== "false";

/**
 * In-sandbox env for the E2B daemon: provider keys + Agenta extension env so the remote
 * Pi traces and runs tools exactly like local. Pi is baked into the template so no
 * PI_ACP_PI_COMMAND override is needed.
 *
 * The bake-status flags are informational only (see the doc comment on
 * `E2B_CODEX_INSTALLED`/`E2B_OPENCODE_INSTALLED`/`E2B_CLAUDE_INSTALLED`): the daemon has no env
 * var that skips `install-agent`, so these do not change daemon behavior. They are surfaced in
 * the sandbox env so a `sandbox-agent server` log/support bundle can show what the operator's
 * template intends to have baked, for debugging a template that silently fell out of date.
 */
export function e2bEnvVars(
  piExtEnv: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  return {
    PI_CODING_AGENT_DIR: E2B_PI_DIR,
    AGENTA_AGENT_SANDBOX_CODEX_INSTALLED: String(E2B_CODEX_INSTALLED),
    AGENTA_AGENT_SANDBOX_OPENCODE_INSTALLED: String(E2B_OPENCODE_INSTALLED),
    AGENTA_AGENT_SANDBOX_CLAUDE_INSTALLED: String(E2B_CLAUDE_INSTALLED),
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
