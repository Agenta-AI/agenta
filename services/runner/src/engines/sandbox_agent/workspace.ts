import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { dirname as posixDirname, join as posixJoin, resolve as posixResolve } from "node:path/posix";

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
    | "isRemoteSandbox"
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

/** Rejects a harnessFile path that resolves outside `cwd` (e.g. `../escape`). */
function assertContained(cwd: string, filePath: string, resolvedPath: string): void {
  if (resolvedPath !== cwd && !resolvedPath.startsWith(cwd + sep)) {
    throw new Error(`harnessFile path escapes workspace cwd: ${filePath}`);
  }
}

/** Posix variant of `assertContained` for remote sandbox paths (always posix, regardless of host OS). */
function assertContainedPosix(cwd: string, filePath: string, resolvedPath: string): void {
  if (resolvedPath !== cwd && !resolvedPath.startsWith(cwd + "/")) {
    throw new Error(`harnessFile path escapes workspace cwd: ${filePath}`);
  }
}

/**
 * Prepare the run cwd, relay directory, optional AGENTS.md, generic `harnessFiles`, and
 * non-Pi skill packages for local or Daytona runs. `harnessFiles` are written blind: the
 * Python harness adapter already rendered them. Skills stay resolved inline packages on the
 * wire; Pi installs them through its agent dir, while Claude loads project-local
 * `.claude/skills/<name>` directories from the cwd.
 */
export async function prepareWorkspace({
  sandbox,
  plan,
  log = () => {},
}: PrepareWorkspaceInput): Promise<Workspace> {
  const harnessFiles = plan.harnessFiles ?? [];
  const projectSkillRoot = plan.isPi ? undefined : `.${plan.acpAgent}/skills`;

  if (plan.isRemoteSandbox) {
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
    for (const file of harnessFiles) {
      const path = posixJoin(plan.cwd, file.path);
      assertContainedPosix(posixResolve(plan.cwd), file.path, posixResolve(path));
      const parent = posixDirname(path);
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
          log(`skill workspace upload skipped for ${skill.name}: ${err.message}`);
        });
      }
    }
    return { cleanup: async () => {} };
  }

  if (plan.useToolRelay) mkdirSync(plan.relayDir, { recursive: true });
  if (plan.agentsMd) writeFileSync(join(plan.cwd, "AGENTS.md"), plan.agentsMd, "utf-8");
  for (const file of harnessFiles) {
    const path = join(plan.cwd, file.path);
    assertContained(resolve(plan.cwd), file.path, resolve(path));
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
