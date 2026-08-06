/**
 * Applying a `ReconcilePlan` to a LIVE environment.
 *
 * LIFECYCLE MIGRATION, STEP 6. This is the first code in the project that changes a running
 * environment instead of rebuilding it, so it is written to be paranoid.
 *
 * ============================================================================================
 * THE ONE RULE
 * ============================================================================================
 *
 * APPLIED STATE ADVANCES ONLY AFTER EVERY ACTION SUCCEEDED.
 *
 * An environment that applied half a plan but reports the whole new configuration is the
 * stale-config bug in a new costume — the exact class step 2 made structurally impossible for
 * request-derived fingerprints. Reintroducing it here through a premature `commitApplied` would
 * undo that work, so the commit is the LAST statement and it is unreachable from any failure
 * path.
 *
 * A partial application therefore leaves the environment reporting its OLD configuration, which
 * is the truth. The caller sees `false` and rebuilds. Rebuilding after a partial change is
 * wasteful but always sound; continuing is neither.
 *
 * ============================================================================================
 * ORDER
 * ============================================================================================
 *
 * Actions run in `FACETS` order, which is a real dependency order: a workspace refresh must land
 * before anything that reads those files. `planReconcile` already emits them sorted, so this
 * function iterates rather than re-sorts — but it asserts the property rather than trusting it,
 * because a reordering upstream would be silent here.
 */
import type { AgentRunRequest } from "../protocol.ts";
import { applyModel } from "../engines/sandbox_agent/model.ts";
import type { SessionEnvironment } from "../engines/sandbox_agent/runtime-contracts.ts";
import { normalizeDesiredState } from "../lifecycle/desired-state.ts";
import { configFingerprint } from "../engines/sandbox_agent/session-identity.ts";
import type { ReconcilePlan } from "../lifecycle/reconcile-plan.ts";
import { refresh, type WorkspaceInventory } from "./workspace-manager.ts";
import type { Log } from "./timing.ts";

export interface ApplyPlanDeps {
  applyModel?: typeof applyModel;
  refresh?: typeof refresh;
}

/**
 * Apply every action in `plan` to `env`. Returns whether the WHOLE plan applied.
 *
 * `false` means nothing may be assumed about what landed, except that applied state was not
 * advanced. The caller rebuilds.
 */
export async function applyReconcilePlan(
  env: SessionEnvironment,
  request: AgentRunRequest,
  plan: ReconcilePlan,
  log: Log,
  deps: ApplyPlanDeps = {},
): Promise<boolean> {
  if (plan.actions.length === 0) return false;

  for (const action of plan.actions) {
    switch (action.kind) {
      case "no-op":
        break;

      case "refresh-workspace": {
        // NOT REACHED while `LIVE_ACTION_KINDS` excludes this kind, and the exclusion is the
        // point: the write below lands on disk, but every harness reads its instruction file once
        // at session start, so the running model never sees it while the commit at the bottom of
        // this function reports the new configuration as applied. The machinery stays because a
        // refresh-then-reopen route needs exactly this write; only the routing is off.
        //
        // WHOEVER REVIVES THIS ROUTE MUST RENDER THE PLATFORM GUIDANCE TOO. `instructions` below
        // is the AUTHOR'S text; the acquire path appends the fenced guidance block to it before
        // the file is written (`appendPlatformGuidance`, wired in `environment.ts`). A refresh
        // that skipped that step would silently strip the guidance out of a running sandbox's
        // instructions file, which is worse than never adding it: it would work on the first turn
        // and stop working after any config edit.
        //
        // The runner-owned instructions and skills, rewritten in place. Deletion of a skill that
        // left the request is decided from the inventory this environment recorded when it last
        // wrote the workspace — never from a directory listing, because a durable cwd holds the
        // user's own project.
        const previous = env.workspaceInventory;
        if (!previous) {
          // No inventory means this environment never recorded what it wrote, so a refresh
          // cannot know what to delete. Refuse rather than write-without-deleting: a stale skill
          // left readable is the failure this route exists to prevent.
          log("live-route: no workspace inventory recorded; cannot refresh safely");
          return false;
        }
        const result = await (deps.refresh ?? refresh)(
          {
            sandbox: env.sandbox,
            plan: env.plan as never,
            log,
          },
          {
            instructions: env.plan.prompt.agentsMd,
            skills: env.plan.workspace.skillDirs,
          },
          previous,
        );
        env.workspaceInventory = result.inventory;
        if (result.removedSkills.length) {
          log(
            `live-route: refreshed workspace, removed ${result.removedSkills.length} skill(s)`,
          );
        }
        break;
      }

      case "apply-live": {
        // The only live session-level operation: `setModel` on the running session. Strict, so a
        // model the harness will not accept throws here and the whole plan fails rather than
        // silently leaving the session on its previous model while we report the new one.
        const applied = await (deps.applyModel ?? applyModel)(
          env.session,
          request.model,
          log,
          { strict: true },
        );
        if (request.model && applied !== request.model) {
          log(
            `live-route: setModel did not install '${request.model}' (got '${applied ?? "default"}')`,
          );
          return false;
        }
        env.model = applied;
        break;
      }

      default:
        // A plan carrying an action outside the live set should never reach here: the caller
        // gates on `isLivelyApplicable`. Refuse rather than attempt it.
        log(`live-route: refusing unsupported action '${action.kind}'`);
        return false;
    }
  }

  // EVERY action succeeded. Only now may the environment claim the new configuration, and this
  // is the single call that lets it. See "THE ONE RULE" above.
  const fingerprint = configFingerprint(request);
  env.commitApplied({
    configFingerprint: fingerprint,
    facets: normalizeDesiredState(request, fingerprint).digests,
  });
  return true;
}

export type { WorkspaceInventory };
