import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildClaudeSettings } from "./claude-settings.ts";
import type { RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

export interface Workspace {
  cleanup: () => Promise<void>;
}

export interface PrepareWorkspaceInput {
  sandbox: any;
  plan: Pick<
    RunPlan,
    | "isDaytona"
    | "cwd"
    | "relayDir"
    | "useToolRelay"
    | "agentsMd"
    | "acpAgent"
    | "claudeSettings"
    | "sandboxPermission"
    | "mcpServers"
  >;
  log?: Log;
}

/**
 * Prepare the run cwd, relay directory, optional AGENTS.md, and (for Claude) the
 * `.claude/settings.json` harness-config file, for local or Daytona runs. The settings file is
 * only written when `buildClaudeSettings` returns one (Claude harness with author options
 * and/or Layer-2-derived rules); Pi runs never get it.
 */
export async function prepareWorkspace({
  sandbox,
  plan,
  log = () => {},
}: PrepareWorkspaceInput): Promise<Workspace> {
  const claudeSettings = buildClaudeSettings(plan);

  if (plan.isDaytona) {
    await sandbox.mkdirFs({ path: plan.cwd }).catch((err: Error) => {
      log(`workspace mkdir skipped: ${err.message}`);
    });
    if (plan.useToolRelay) {
      await sandbox.mkdirFs({ path: plan.relayDir }).catch((err: Error) => {
        log(`tool relay dir mkdir skipped: ${err.message}`);
      });
    }
    if (plan.agentsMd) {
      await sandbox.writeFsFile({ path: `${plan.cwd}/AGENTS.md` }, plan.agentsMd);
    }
    if (claudeSettings) {
      await sandbox.mkdirFs({ path: `${plan.cwd}/.claude` }).catch((err: Error) => {
        log(`.claude dir mkdir skipped: ${err.message}`);
      });
      await sandbox.writeFsFile(
        { path: `${plan.cwd}/.claude/settings.json` },
        `${JSON.stringify(claudeSettings, null, 2)}\n`,
      );
    }
    return { cleanup: async () => {} };
  }

  if (plan.useToolRelay) mkdirSync(plan.relayDir, { recursive: true });
  if (plan.agentsMd) writeFileSync(join(plan.cwd, "AGENTS.md"), plan.agentsMd, "utf-8");
  if (claudeSettings) {
    mkdirSync(join(plan.cwd, ".claude"), { recursive: true });
    writeFileSync(
      join(plan.cwd, ".claude", "settings.json"),
      `${JSON.stringify(claudeSettings, null, 2)}\n`,
      "utf-8",
    );
  }

  return {
    cleanup: async () => {
      rmSync(plan.cwd, { recursive: true, force: true });
    },
  };
}
