import { prepareDaytonaPiAssets } from "./daytona.ts";
import type { RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

/** Minimal sandbox filesystem surface used for remote asset uploads. */
export interface SandboxHandle {
  mkdirFs(opts: { path: string }): Promise<unknown>;
  writeFsFile(opts: { path: string }, content: string): Promise<unknown>;
  runProcess?(opts: unknown): Promise<unknown>;
}

export interface PrepareRemoteHarnessAssetsInput {
  sandbox: SandboxHandle;
  plan: Pick<
    RunPlan,
    | "acpAgent"
    | "secrets"
    | "isPi"
    | "credentialMode"
    | "hasApiKey"
    | "skillDirs"
    | "hasSystemPrompt"
    | "systemPrompt"
    | "appendSystemPrompt"
  >;
  log?: Log;
}

const CODEX_DIR =
  process.env.AGENTA_AGENT_SANDBOX_CODEX_DIR ?? "/root/.codex";

/** Write `~/.codex/auth.json` with the resolved OpenAI key. Best-effort. */
export async function writeCodexAuthToSandbox(
  sandbox: SandboxHandle,
  secrets: Record<string, string>,
  log: Log,
): Promise<void> {
  const key = secrets.OPENAI_API_KEY;
  if (!key) {
    log("codex remote auth skipped: no OPENAI_API_KEY in secrets");
    return;
  }
  try {
    await sandbox.mkdirFs({ path: CODEX_DIR });
    await sandbox.writeFsFile(
      { path: `${CODEX_DIR}/auth.json` },
      JSON.stringify({ OPENAI_API_KEY: key }),
    );
  } catch (err) {
    log(`codex auth upload skipped: ${(err as Error).message}`);
  }
}

/**
 * Provision harness credentials in a remote sandbox (Daytona, E2B, ...).
 *
 * Pi delegates to `prepareDaytonaPiAssets` unchanged. Codex writes
 * `~/.codex/auth.json` (codex always reads credentials from disk, not just env).
 * Claude and opencode receive their keys via env vars in the sandbox create object
 * and need no file upload.
 */
export async function prepareRemoteHarnessAssets({
  sandbox,
  plan,
  log = () => {},
}: PrepareRemoteHarnessAssetsInput): Promise<void> {
  switch (plan.acpAgent) {
    case "pi":
      await prepareDaytonaPiAssets({ sandbox, plan, log });
      break;
    case "codex":
      await writeCodexAuthToSandbox(sandbox, plan.secrets, log);
      break;
    case "claude":
    case "opencode":
      break;
    default:
      log(`prepareRemoteHarnessAssets: unknown acpAgent '${plan.acpAgent}', skipping`);
  }
}
