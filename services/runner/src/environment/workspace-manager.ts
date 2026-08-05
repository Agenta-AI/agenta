/**
 * `WorkspaceManager` — the run directory's managed files.
 *
 * LIFECYCLE MIGRATION, STEP 5. This unit owns one acquire stage (`prepare_workspace`) and one
 * teardown step (the workspace cleanup). It is the first unit to split out because it is the one
 * step 6 needs: an in-place workspace refresh is the cheapest live route in the whole design.
 *
 * WHAT "MANAGED" MEANS. The runner owns `AGENTS.md` / `CLAUDE.md`, the rendered harness files, and
 * the skill directories. It does NOT own anything else in the run directory: an agent's own
 * working files are the user's, and a refresh must never touch them. That boundary is why
 * `refresh` takes an explicit manifest rather than reconciling the whole tree.
 *
 * THE `refresh` ENTRY IS DELIBERATELY UNWIRED. Step 5 is a structural split with zero behavior
 * change, so nothing calls `refresh` yet. It exists now, sharing its write path with
 * `materialize`, so step 6 is a routing change rather than a new implementation. See the note on
 * `refresh` for what it still owes.
 */
import {
  prepareWorkspace,
  type Workspace,
} from "../engines/sandbox_agent/workspace.ts";
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
 * Write every managed file for a fresh run directory.
 *
 * This is byte-for-byte what the `prepare_workspace` stage did inline. The caller still owns the
 * timing mark and the local-remount retry, because both are acquire-path concerns rather than
 * workspace concerns: the retry re-signs a MOUNT, which belongs to the mount unit.
 */
export async function materialize(
  input: WorkspaceInput,
  deps: WorkspaceDeps = {},
): Promise<Workspace> {
  return (deps.prepareWorkspace ?? prepareWorkspace)({
    sandbox: input.sandbox,
    plan: input.plan,
    piSkillSnapshot: input.piSkillSnapshot,
    log: input.log,
  });
}

/**
 * The set of managed files a refresh should end with.
 *
 * A manifest is a complete statement, not a delta. That is what lets a refresh delete a skill
 * directory that disappeared from the request: the manager compares what it wrote last against
 * what the manifest asks for, and removes the difference. A delta could never express a removal
 * safely, because it cannot distinguish "unchanged" from "gone".
 */
export interface WorkspaceManifest {
  /** Relative path to content, for every file the runner owns in this run directory. */
  readonly files: ReadonlyMap<string, string>;
  /** Skill directory names the runner owns. Anything else under the skills root is removed. */
  readonly skillDirs: readonly string[];
}

/**
 * STEP 6 ENTRY. Bring an EXISTING run directory to the state a manifest describes.
 *
 * NOT WIRED, AND NOT YET COMPLETE. Step 5 changes no behavior, so nothing calls this. It is
 * declared now so step 6 is a routing change rather than a new implementation, and so the shape
 * of the manifest is settled while the split is fresh.
 *
 * WHAT IT STILL OWES, and none of it may be skipped when step 6 wires it:
 *  - DELETION. `prepareWorkspace` writes desired files and does not remove files that vanished
 *    from the request. A refresh that only writes leaves a removed skill readable by the model,
 *    which is a correctness bug and, for a removed skill, a policy one.
 *  - A RUNNER-OWNED INVENTORY. Deletion is only safe against a record of what the runner itself
 *    wrote. Never recursively clean the run directory: it holds the agent's own files.
 *  - ATOMIC REPLACEMENT where the platform allows it, so a half-written instructions file is
 *    never visible to a running harness.
 *  - THE OBSERVATION QUESTION. Writing a file does not prove a running harness reads it. The
 *    adapter matrix records instructions and skills as `not-guaranteed` for an active session,
 *    so step 6 must decide per harness whether a refresh alone is honest or whether it must be
 *    followed by a session reopen.
 */
export async function refresh(
  _input: WorkspaceInput,
  _manifest: WorkspaceManifest,
  _deps: WorkspaceDeps = {},
): Promise<Workspace> {
  throw new Error(
    "WorkspaceManager.refresh is not implemented: step 5 is a structural split with no " +
      "behavior change. Step 6 wires it, and must first add manifest-based deletion against a " +
      "runner-owned inventory. See the doc comment.",
  );
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
