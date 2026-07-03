import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { RunPlan } from "./run-plan.ts";
import { uploadDirToSandbox } from "./pi-assets.ts";

type Log = (message: string) => void;

export interface Workspace {
  cleanup: () => Promise<void>;
}

export interface PrepareWorkspaceInput {
  sandbox: any;
  plan: Pick<
    RunPlan,
    | "isDaytona"
    | "isPi"
    | "cwd"
    | "relayDir"
    | "useToolRelay"
    | "agentsMd"
    | "acpAgent"
    | "harnessFiles"
    | "skillDirs"
  >;
  log?: Log;
}

/**
 * Prepare the run cwd, relay directory, the instructions memory file, generic `harnessFiles`,
 * and non-Pi skill packages for local or Daytona runs. `harnessFiles` are written blind: the
 * Python harness adapter already rendered them. Skills stay resolved inline packages on the
 * wire; Pi installs them through its agent dir, while Claude loads project-local
 * `.claude/skills/<name>` directories from the cwd.
 *
 * The instructions (`agentsMd`) filename is harness-aware. Claude runs through
 * `@anthropic-ai/claude-agent-sdk`, whose memory loader auto-loads `CLAUDE.md` only and never
 * reads `AGENTS.md`, so for the claude harness the instructions must land in `CLAUDE.md` to be
 * read at all (the ACP adapter's `settingSources` already includes `project`+`local`, which
 * loads a root `CLAUDE.md`). Pi reads `AGENTS.md`, so every non-claude harness keeps that name.
 */
export async function prepareWorkspace({
  sandbox,
  plan,
  log = () => {},
}: PrepareWorkspaceInput): Promise<Workspace> {
  const harnessFiles = plan.harnessFiles ?? [];
  const projectSkillRoot = plan.isPi ? undefined : `.${plan.acpAgent}/skills`;
  // Claude's memory loader reads CLAUDE.md, never AGENTS.md; Pi (and any other harness) reads
  // AGENTS.md. See the doc comment above and docs/design/agent-workflows/projects/
  // builder-agent-reliability/agentsmd-claude-fix/README.md.
  const instructionsFile =
    plan.acpAgent === "claude" ? "CLAUDE.md" : "AGENTS.md";

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
      await sandbox.writeFsFile(
        { path: `${plan.cwd}/${instructionsFile}` },
        plan.agentsMd,
      );
    }
    for (const file of harnessFiles) {
      const path = `${plan.cwd}/${file.path}`;
      const parent = dirname(path);
      await sandbox.mkdirFs({ path: parent }).catch((err: Error) => {
        log(`harness file dir mkdir skipped: ${err.message}`);
      });
      await sandbox.writeFsFile({ path }, file.content);
    }
    if (projectSkillRoot) {
      for (const skill of plan.skillDirs) {
        await uploadDirToSandbox(
          sandbox,
          skill.dir,
          `${plan.cwd}/${projectSkillRoot}/${skill.name}`,
        ).catch((err: Error) => {
          log(
            `skill workspace upload skipped for ${skill.name}: ${err.message}`,
          );
        });
      }
    }
    return { cleanup: async () => {} };
  }

  if (plan.useToolRelay) mkdirSync(plan.relayDir, { recursive: true });
  if (plan.agentsMd)
    writeFileSync(join(plan.cwd, instructionsFile), plan.agentsMd, "utf-8");
  for (const file of harnessFiles) {
    const path = join(plan.cwd, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content, "utf-8");
  }
  if (projectSkillRoot) {
    for (const skill of plan.skillDirs) {
      const dest = join(plan.cwd, projectSkillRoot, skill.name);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(skill.dir, dest, { recursive: true, dereference: true });
    }
  }

  return {
    cleanup: async () => {
      rmSync(plan.cwd, { recursive: true, force: true });
    },
  };
}
