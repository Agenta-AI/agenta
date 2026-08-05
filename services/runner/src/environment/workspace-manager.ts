/**
 * `WorkspaceManager` — the run directory's managed files.
 *
 * LIFECYCLE MIGRATION, STEPS 5 AND 6. Step 5 split this unit out. Step 6 implements `refresh`:
 * the cheapest live route in the whole design, rewriting instructions and skills in place on a
 * running sandbox instead of rebuilding it.
 *
 * WHAT "MANAGED" MEANS. The runner owns `AGENTS.md` / `CLAUDE.md`, the rendered harness files, and
 * the skill directories. It does NOT own anything else in the run directory: an agent's own
 * working files are the user's, and a refresh must never touch them. That boundary is why
 * `refresh` takes an explicit manifest rather than reconciling the whole tree.
 *
 * WHY DELETION NEEDS AN INVENTORY. A refresh can never reconcile the tree: it cannot ask "what is
 * here that should not be?", because almost everything in a durable cwd is the user's. It can only
 * ask "what did I write last time that I am not writing now?" — and that needs a record of what it
 * wrote. That record is `WorkspaceInventory`, and it is why `materialize` returns one.
 *
 * THE FAILURE THIS PREVENTS: a skill removed from the request stays readable by the model. For an
 * ordinary skill that is a correctness bug. For a skill removed BECAUSE it was unsafe, the removal
 * silently does nothing.
 */
import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  prepareWorkspace,
  type Workspace,
} from "../engines/sandbox_agent/workspace.ts";
import { uploadDirToSandbox } from "../engines/sandbox_agent/pi-assets.ts";
import type { PiSkillSnapshot } from "../engines/sandbox_agent/pi-assets.ts";
import type { RunPlan } from "../engines/sandbox_agent/run-plan.ts";
import type { Log } from "./timing.ts";

/** Everything a workspace write needs. The same shape serves both entries. */
export interface WorkspaceInput {
  sandbox: unknown;
  plan: Parameters<typeof prepareWorkspace>[0]["plan"];
  piSkillSnapshot?: PiSkillSnapshot;
  log: Log;
}

/** The seam tests and the composer both inject through this. */
export interface WorkspaceDeps {
  prepareWorkspace?: typeof prepareWorkspace;
}

/**
 * What the runner wrote, so it can tell later what to remove.
 *
 * DELIBERATELY NOT A CONTENT RECORD. It holds identities only, because a refresh compares what
 * SHOULD exist against what DID, never old bytes against new ones.
 */
export interface WorkspaceInventory {
  /** `CLAUDE.md` or `AGENTS.md`, relative to the cwd. Undefined when none was written. */
  readonly instructionsFile: string | undefined;
  /** Skill directory names under `skillRoot`. Empty for a harness with no project skill root. */
  readonly skillNames: readonly string[];
  /** Where skill directories live relative to the cwd, e.g. `.claude/skills`. */
  readonly skillRoot: string | undefined;
}

/** The workspace handle plus the record of what produced it. */
export interface ManagedWorkspace extends Workspace {
  readonly inventory: WorkspaceInventory;
}

/** Claude's memory loader reads `CLAUDE.md` and never `AGENTS.md`; everything else reads the latter. */
function instructionsFileFor(acpAgent: string): string {
  return acpAgent === "claude" ? "CLAUDE.md" : "AGENTS.md";
}

/** Pi loads one content-addressed snapshot instead of project-local skill directories. */
function skillRootFor(plan: { isPi: boolean; acpAgent: string }): string | undefined {
  return plan.isPi ? undefined : `.${plan.acpAgent}/skills`;
}

/** The inventory a plan implies: what a write of this plan leaves behind. */
export function inventoryOf(plan: WorkspaceInput["plan"]): WorkspaceInventory {
  const p = plan as unknown as {
    isPi?: boolean;
    acpAgent?: string;
    prompt?: { agentsMd?: string };
    workspace?: { skillDirs?: Array<{ name: string }> };
  };
  // Absence reads as "wrote nothing", never as a throw. `materialize` calls this, so a throw here
  // would fail an acquisition; and an EMPTY inventory is the safe direction, because a later
  // refresh then deletes nothing rather than deleting something it never wrote.
  const skillRoot = skillRootFor({
    isPi: !!p.isPi,
    acpAgent: p.acpAgent ?? "",
  });
  return {
    instructionsFile: p.prompt?.agentsMd
      ? instructionsFileFor(p.acpAgent ?? "")
      : undefined,
    skillNames: skillRoot ? (p.workspace?.skillDirs ?? []).map((s) => s.name) : [],
    skillRoot,
  };
}

/**
 * Write every managed file for a fresh run directory.
 *
 * Byte-for-byte what the `prepare_workspace` stage did inline, plus the inventory. The caller
 * still owns the timing mark and the local-remount retry, because the retry re-signs a MOUNT,
 * which belongs to the mount unit.
 */
export async function materialize(
  input: WorkspaceInput,
  deps: WorkspaceDeps = {},
): Promise<ManagedWorkspace> {
  const workspace = await (deps.prepareWorkspace ?? prepareWorkspace)({
    sandbox: input.sandbox,
    plan: input.plan,
    piSkillSnapshot: input.piSkillSnapshot,
    log: input.log,
  });
  return { ...workspace, inventory: inventoryOf(input.plan) };
}

/**
 * What a refresh should leave behind. A COMPLETE statement, never a delta.
 *
 * A delta could not express a removal: it cannot distinguish "unchanged" from "gone". The
 * manifest plus the previous inventory is what makes deletion decidable.
 */
export interface WorkspaceManifest {
  /** The instructions text, or undefined to remove the file. */
  readonly instructions: string | undefined;
  /** The skill directories that should exist, by name and materialized source dir. */
  readonly skills: ReadonlyArray<{ name: string; dir: string }>;
}

export interface RefreshResult {
  readonly inventory: WorkspaceInventory;
  /** Skill names removed, so the caller can log what the refresh actually did. */
  readonly removedSkills: readonly string[];
}

/**
 * Bring an EXISTING run directory to the state a manifest describes.
 *
 * SCOPE: INSTRUCTIONS AND SKILLS ONLY. Those are exactly what the `workspaceFiles` facet
 * carries, and that facet is the narrowest of the four the old coarse `workspace` facet held.
 * Prompts and harness files are NOT refreshed here — they escalate to a session reopen, because
 * prompt observation is not guaranteed and a harness file may be a permission file. Widening this
 * function without widening that facet would route a security-relevant change through an in-place
 * write, which is the failure the facet split exists to prevent.
 *
 * ORDER: delete first, then write. A skill removed and another added in one refresh must not be
 * able to collide on a directory name mid-operation.
 *
 * ATOMICITY, STATED HONESTLY:
 *  - A LOCAL FILE is atomic. Content goes to a temp name in the SAME directory and is renamed
 *    over the target, so a reader sees either the whole old file or the whole new one.
 *  - A LOCAL SKILL DIRECTORY is not atomic as a unit: it is removed and re-copied, so a reader
 *    inside that window can see a partial skill. Accepted, because the alternative is swapping in
 *    a staged sibling directory and neither the Pi nor the Claude loader expects that.
 *  - A DAYTONA WRITE is not atomic at all. The daemon FS API exposes no rename-over to lean on,
 *    so a remote instructions write has a one-call window. Recorded rather than hidden.
 *
 * A FAILED DELETE THROWS. Leaving a removed skill readable is the exact outcome this route exists
 * to prevent, so the caller must fall back to a rebuild rather than continue.
 */
export async function refresh(
  input: WorkspaceInput,
  manifest: WorkspaceManifest,
  previous: WorkspaceInventory,
): Promise<RefreshResult> {
  const p = input.plan as unknown as {
    isPi: boolean;
    isDaytona: boolean;
    acpAgent: string;
    workspace: { cwd: string };
  };
  const sandbox = input.sandbox as {
    writeFsFile?: (q: { path: string }, body: string) => Promise<unknown>;
    deleteFsEntry?: (q: { path: string }) => Promise<unknown>;
  };
  const cwd = p.workspace.cwd;
  const skillRoot = skillRootFor(p);
  const instructionsFile = instructionsFileFor(p.acpAgent);

  // ---- 1. Deletions, decided from the INVENTORY and never from a directory listing. ----
  // Listing the tree would put the agent's own files in scope, and almost nothing there is the
  // runner's to remove.
  const wanted = new Set(manifest.skills.map((s) => s.name));
  const removedSkills = previous.skillNames.filter((n) => !wanted.has(n));
  if (previous.skillRoot) {
    for (const name of removedSkills) {
      const target = `${cwd}/${previous.skillRoot}/${name}`;
      try {
        if (p.isDaytona) await sandbox.deleteFsEntry?.({ path: target });
        else rmSync(target, { recursive: true, force: true });
        input.log(`workspace refresh removed skill=${name}`);
      } catch (err) {
        throw new Error(
          `workspace refresh could not remove skill '${name}': ${(err as Error).message}`,
        );
      }
    }
  }
  if (previous.instructionsFile && manifest.instructions === undefined) {
    const target = `${cwd}/${previous.instructionsFile}`;
    if (p.isDaytona) await sandbox.deleteFsEntry?.({ path: target }).catch(() => {});
    else rmSync(target, { force: true });
  }

  // ---- 2. Writes. ----------------------------------------------------------------------
  if (manifest.instructions !== undefined) {
    if (p.isDaytona) {
      await sandbox.writeFsFile?.(
        { path: `${cwd}/${instructionsFile}` },
        manifest.instructions,
      );
    } else {
      writeFileAtomic(join(cwd, instructionsFile), manifest.instructions);
    }
  }

  if (skillRoot) {
    for (const skill of manifest.skills) {
      const target = `${cwd}/${skillRoot}/${skill.name}`;
      if (p.isDaytona) {
        await sandbox.deleteFsEntry?.({ path: target }).catch(() => {});
        await uploadDirToSandbox(input.sandbox, skill.dir, target);
      } else {
        rmSync(target, { recursive: true, force: true });
        mkdirSync(dirname(target), { recursive: true });
        cpSync(skill.dir, target, { recursive: true });
      }
    }
  }

  return { inventory: inventoryOf(input.plan), removedSkills };
}

/**
 * Write a file so a concurrent reader never sees it half-written.
 *
 * The temp name MUST be in the same directory as the target: `rename` is only atomic within one
 * filesystem, and a temp file elsewhere could cross a mount boundary and degrade to a copy.
 */
function writeFileAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const staging = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(staging, content, "utf-8");
  try {
    renameSync(staging, target);
  } catch (err) {
    rmSync(staging, { force: true });
    throw err;
  }
}

/**
 * Remove what this run wrote. Called from the composer's teardown.
 *
 * The caller decides WHETHER to call it: on a durable local run the cleanup must be skipped
 * unless the unmount was confirmed, or it would delete through a live mount into the store. That
 * decision needs mount state, so it stays with the mount unit and the composer.
 */
export async function cleanup(workspace: Workspace | undefined): Promise<void> {
  await workspace?.cleanup().catch(() => {});
}
