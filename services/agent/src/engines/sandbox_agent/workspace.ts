import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RunPlan } from "./run-plan.ts";

type Log = (message: string) => void;

export interface Workspace {
  cleanup: () => Promise<void>;
}

export interface PrepareWorkspaceInput {
  sandbox: any;
  plan: Pick<RunPlan, "isDaytona" | "cwd" | "relayDir" | "useToolRelay" | "agentsMd">;
  log?: Log;
}

/** Prepare the run cwd, relay directory, and optional AGENTS.md for local or Daytona runs. */
export async function prepareWorkspace({
  sandbox,
  plan,
  log = () => {},
}: PrepareWorkspaceInput): Promise<Workspace> {
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
    return { cleanup: async () => {} };
  }

  if (plan.useToolRelay) mkdirSync(plan.relayDir, { recursive: true });
  if (plan.agentsMd) writeFileSync(join(plan.cwd, "AGENTS.md"), plan.agentsMd, "utf-8");

  return {
    cleanup: async () => {
      rmSync(plan.cwd, { recursive: true, force: true });
    },
  };
}
