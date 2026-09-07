/**
 * `MountLifecycle` — the two durable mounts and everything that keeps them alive.
 *
 * LIFECYCLE MIGRATION, STEP 5 (S7b). This unit is the reason `AcquireContext` exists. The six
 * helpers below were mutually recursive closures sharing one scope in `acquireEnvironment`; they
 * are now ordinary functions that take `ctx` and capture nothing.
 *
 * ZERO BEHAVIOR CHANGE. Every guard, every log string, every early return and every ordering is
 * preserved. The only differences are mechanical: reads go through `ctx.env`, writes go through a
 * named committer, and the two broad catches now start with `rethrowIfInvariant`.
 *
 * ============================================================================================
 * THE TWO MOUNTS, AND WHY THEY ARE NOT SYMMETRIC
 * ============================================================================================
 *
 *  - The DURABLE CWD is the run directory. It is keyed by SESSION, signed with `signMount`, and
 *    its path is the plan's cwd. Teardown must unmount it before deleting anything under it.
 *  - The AGENT MOUNT is the harness's own home (logins, agent files). It is keyed by ARTIFACT,
 *    signed with `signAgentMount`, and lives at a SIBLING path of the cwd. It carries guidance:
 *    a successful agent mount tells the model that durable storage exists.
 *
 * Only the agent mount runs the guidance path, and only the cwd mount participates in the
 * `durableCwdSafeToDelete` handshake. That asymmetry is why the helpers are separate functions
 * rather than one parameterized by `MountKind`.
 *
 * ============================================================================================
 * THE INVARIANT THIS UNIT MUST RESPECT
 * ============================================================================================
 *
 * INVARIANT 1 (see `acquire-context.ts`): a LOCAL mount must complete before the sandbox provider
 * takes the daemon env maps by reference. The guidance path writes `AGENT_MOUNT_ENV_VAR`, so a
 * local mount landing after the freeze would write into maps nobody reads again and the harness
 * would never learn about its own durable storage.
 *
 * `ctx.writeDaemonEnv` throws `AcquireInvariantError` in that case. Both broad catches in this
 * file therefore call `rethrowIfInvariant(err)` FIRST. Without it, `mountLocalAgentCwd`'s catch
 * would swallow the violation and log it as an ordinary mount failure — which is exactly what the
 * external review caught in revision 1 of the contract.
 */
import { mkdirSync, rmSync } from "node:fs";

import { apiBase } from "../apiBase.ts";
import {
  AGENT_MOUNT_ENV_VAR,
  agentMountPath,
  linkAgentFiles,
  seedAgentReadme,
} from "../engines/sandbox_agent/agent-mount.ts";
import {
  agentMountAppendix,
  agentMountUnavailableAppendix,
} from "../engines/sandbox_agent/agent-mount-guidance.ts";
import { composeSystemPromptAppendix } from "../engines/sandbox_agent/system-prompt-appendix.ts";
import {
  isSubscriptionCodexRun,
  symlinkCodexSubscriptionAuthFile,
} from "../engines/sandbox_agent/codex-assets.ts";
import { conciseError } from "../engines/sandbox_agent/errors.ts";
import { mountStorage } from "../engines/sandbox_agent/mount.ts";
import {
  uploadSystemPromptToSandbox,
  writeSystemPromptLocal,
} from "../engines/sandbox_agent/pi-assets.ts";
import { containsTransportEndpointDisconnected } from "../engines/sandbox_agent/runtime-policy.ts";
import { throwIfAcquireAborted } from "./acquire-abort.ts";
import { rethrowIfInvariant, type AcquireContext } from "./acquire-context.ts";

/** The Pi agent directory inside a Daytona sandbox. Injected so this unit stays import-light. */
export interface MountDeps {
  mountStorage?: typeof mountStorage;
  signMount: (
    sessionId: string,
    opts: { apiBase: string; authorization: string; log: (m: string) => void },
  ) => Promise<import("../engines/sandbox_agent/mount.ts").MountCredentials | null>;
  signAgentMount: (
    artifactId: string,
    opts: { apiBase: string; authorization: string; log: (m: string) => void },
  ) => Promise<import("../engines/sandbox_agent/mount.ts").MountCredentials | null>;
  /** The remote Pi directory constant, passed in rather than imported. */
  daytonaPiDir: string;
  /** The turn signal that must preempt a mount during environment acquisition. */
  signal?: AbortSignal;
}

/**
 * Tell the model that durable storage was attempted for this run and is NOT reachable.
 *
 * The mirror of `activateAgentMountGuidance`, and it exists for the reason spelled out on
 * `agentMountUnavailableGuidance`: the model's history can contain a session where the folder
 * worked, and only a statement in THIS turn can contradict it.
 *
 * It writes no daemon env var, because there is no path to advertise. It reuses the same prompt
 * channels as the positive case so the two can never disagree about how the model is told.
 */
export async function activateAgentMountUnavailableGuidance(
  ctx: AcquireContext,
  deps: MountDeps,
): Promise<void> {
  if (ctx.guidanceActive) return;
  ctx.markGuidanceActive();

  const plan = ctx.plan;
  if (!plan.isPi) return;

  ctx.appendAgentMountGuidance(
    composeSystemPromptAppendix([agentMountUnavailableAppendix()]) ?? "",
  );

  if (plan.isDaytona) {
    await uploadSystemPromptToSandbox(
      ctx.env.sandbox,
      deps.daytonaPiDir,
      plan.prompt.systemPrompt,
      plan.prompt.appendSystemPrompt,
      ctx.log,
    );
    return;
  }
  if (ctx.env.runAgentDir) {
    writeSystemPromptLocal(
      ctx.env.runAgentDir,
      plan.prompt.systemPrompt,
      plan.prompt.appendSystemPrompt,
      ctx.log,
    );
  }
}

/**
 * Tell the model that durable storage exists, once.
 *
 * Runs only after an agent mount is CONFIRMED live. It has four outcomes, in priority order, and
 * every one is preserved from the original:
 *   1. Not local -> no daemon env write (Daytona's env is already frozen by construction).
 *   2. Not Pi    -> stop after the env write; only Pi takes the prompt segment.
 *   3. Daytona   -> upload the composed prompt into the sandbox.
 *   4. Local     -> write it beside the agent dir, re-preparing the dir if this is the
 *                   subscription path that has none yet.
 */
export async function activateAgentMountGuidance(
  ctx: AcquireContext,
  deps: MountDeps,
): Promise<void> {
  const mountedPath = ctx.env.agentMountedPath;
  if (!mountedPath || ctx.guidanceActive) return;
  ctx.markGuidanceActive();

  const plan = ctx.plan;
  // Only advertise durable storage after the mount is confirmed active. Local daemon env is
  // still mutable here because local mounts run before SandboxAgent.start. Daytona cannot change
  // daemon env after sandbox creation, so its harness discovers the mount through the post-mount
  // system-prompt channel and the cwd-local agent-files symlink instead.
  if (!plan.isDaytona) {
    // INVARIANT 1. Throws `AcquireInvariantError` if the provider already froze the env.
    ctx.writeDaemonEnv(AGENT_MOUNT_ENV_VAR, mountedPath);
  }
  if (!plan.isPi) return;

  ctx.appendAgentMountGuidance(
    composeSystemPromptAppendix([agentMountAppendix(mountedPath)]) ?? "",
  );

  if (plan.isDaytona) {
    await uploadSystemPromptToSandbox(
      ctx.env.sandbox,
      deps.daytonaPiDir,
      plan.prompt.systemPrompt,
      plan.prompt.appendSystemPrompt,
      ctx.log,
    );
    return;
  }
  if (ctx.env.runAgentDir) {
    writeSystemPromptLocal(
      ctx.env.runAgentDir,
      plan.prompt.systemPrompt,
      plan.prompt.appendSystemPrompt,
      ctx.log,
    );
    return;
  }
  // Discarding `.extensionInstalled` here is safe, and a fail-closed throw would be unsound
  // anyway: both callers wrap this in a mount try/catch that logs and continues, so a throw could
  // not stop the run. Reachability: managed/none local Pi runs always created a throwaway dir in
  // the first `prepareLocalPiAssets` call and returned above, so only the subscription
  // (runtime_provided) path reaches this re-prep. That path installs into the SAME operator mount
  // the first call installed into, and the fail-closed gating check after that first call stopped
  // the run when the install was required but failed.
  ctx.setRunAgentDir(ctx.reprepareLocalPiAssets());
}

/** Mount the durable cwd on the local host. Returns whether it is live. */
export async function mountLocalDurableCwd(
  ctx: AcquireContext,
  deps: MountDeps,
  reason: string,
): Promise<boolean> {
  const plan = ctx.plan;
  const creds = ctx.env.mountCreds;
  if (!creds || plan.isDaytona) return false;
  ctx.log(
    `local durable cwd mount (${reason}) session=${ctx.sessionForMount} cwd=${plan.workspace.cwd}`,
  );
  // A mount is starting, so the path may become live: the workspace must not be deleted.
  ctx.beginCwdMount();
  const mounted = await (deps.mountStorage ?? mountStorage)(
    plan.workspace.cwd,
    creds,
    { log: ctx.log, signal: deps.signal },
  );
  if (mounted) {
    ctx.commitLocalMount("cwd", plan.workspace.cwd, creds);
    throwIfAcquireAborted(deps.signal);
    // Session-local links belong to the mount's lifecycle, not to first acquire: this mount is
    // object storage, which has no symlinks, so a remount hands back a 0-byte file where the link
    // was. Re-materialize the subscription Codex login link here, AFTER the mount is live
    // (linking before it would be shadowed). Idempotent, and a no-op for every other run.
    if (isSubscriptionCodexRun(plan)) {
      await symlinkCodexSubscriptionAuthFile(plan, ctx.log).catch((err) => {
        ctx.log(
          `codex subscription auth.json link failed after mount: ${conciseError(err, plan.harness)}`,
        );
      });
    }
    return true;
  }
  throwIfAcquireAborted(deps.signal);
  // A false result means mountStorage stopped the attempt and CONFIRMED the path detached.
  ctx.markCwdDetachConfirmed();
  return false;
}

/** Mount the agent home on the local host, then run the guidance. Returns whether it is live. */
export async function mountLocalAgentCwd(
  ctx: AcquireContext,
  deps: MountDeps,
): Promise<boolean> {
  const plan = ctx.plan;
  const creds = ctx.env.agentMountCreds;
  if (!creds || plan.isDaytona) return false;
  const mountPath = agentMountPath(plan.workspace.cwd);
  if (ctx.env.agentMountedPath === mountPath) return true;
  try {
    mkdirSync(mountPath, { recursive: true });
    if (
      !(await (deps.mountStorage ?? mountStorage)(mountPath, creds, {
        log: ctx.log,
        signal: deps.signal,
      }))
    ) {
      // false means mountStorage confirmed detach is safe. This path is a sibling of the session
      // cwd, so workspace cleanup cannot remove the failed mountpoint stub.
      rmSync(mountPath, { recursive: true, force: true });
      return false;
    }
    ctx.commitLocalMount("agent", mountPath, creds);
    throwIfAcquireAborted(deps.signal);
    await seedAgentReadme(mountPath, { log: ctx.log });
    await linkAgentFiles(plan.workspace.cwd, mountPath, { log: ctx.log });
    await activateAgentMountGuidance(ctx, deps);
    return true;
  } catch (err) {
    // INVARIANT 1's escape hatch. `activateAgentMountGuidance` runs INSIDE this try, so without
    // this line an ordering violation would be logged as an ordinary mount failure and the run
    // would continue with a harness that cannot see its durable storage. This is the exact defect
    // the external review found in revision 1 of the contract.
    rethrowIfInvariant(err);
    ctx.log(
      `local agent mount failed artifact=${ctx.artifactId}: ${conciseError(err, plan.harness)}`,
    );
    return false;
  }
}

/**
 * Re-sign the agent mount credential and remount.
 *
 * INVARIANT 2: the fresh credential is committed BEFORE the remount is known to have succeeded.
 * That is current behavior, preserved deliberately for this split.
 */
export async function reSignAndRemountLocalAgentMount(
  ctx: AcquireContext,
  deps: MountDeps,
): Promise<boolean> {
  const plan = ctx.plan;
  if (!ctx.artifactId || !ctx.runCred || plan.isDaytona) return false;
  if (!ctx.takeRemountBudget("agent")) {
    ctx.log(
      `local agent mount ENOTCONN remount limit reached artifact=${ctx.artifactId} path=${agentMountPath(plan.workspace.cwd)}`,
    );
    return false;
  }
  ctx.log(
    `local agent mount ENOTCONN artifact=${ctx.artifactId}; re-signing and remounting`,
  );
  const fresh = await deps.signAgentMount(ctx.artifactId, {
    apiBase: apiBase(),
    authorization: ctx.runCred,
    log: ctx.log,
  });
  if (!fresh) {
    // The signer handles its own null, which is why `recordResignedCredential` stays total.
    ctx.log(
      `local agent mount re-sign returned no credentials artifact=${ctx.artifactId}`,
    );
    return false;
  }
  ctx.recordResignedCredential("agent", fresh);
  // Clear the marker so `mountLocalAgentCwd` remounts instead of short-circuiting on its
  // path-identity check.
  ctx.clearMountPath("agent");
  return mountLocalAgentCwd(ctx, deps);
}

/**
 * Re-sign the durable cwd credential and remount.
 *
 * INVARIANT 2 again, with the caveat the review corrected: if the remount below FAILS, the
 * environment keeps the fresh credential while `mountedCwd` stays pointed at the previous
 * successful mount. The two disagree until the next successful remount. Preserved as-is.
 */
export async function reSignAndRemountLocalCwd(
  ctx: AcquireContext,
  deps: MountDeps,
): Promise<boolean> {
  const plan = ctx.plan;
  if (!ctx.sessionForMount || !ctx.runCred || plan.isDaytona) return false;
  if (!ctx.takeRemountBudget("cwd")) {
    ctx.log(
      `local durable cwd ENOTCONN remount limit reached session=${ctx.sessionForMount} cwd=${plan.workspace.cwd}`,
    );
    return false;
  }
  ctx.log(
    `local durable cwd ENOTCONN session=${ctx.sessionForMount} cwd=${plan.workspace.cwd}; re-signing and remounting`,
  );
  const fresh = await deps.signMount(ctx.sessionForMount, {
    apiBase: apiBase(),
    authorization: ctx.runCred,
    log: ctx.log,
  });
  if (!fresh) {
    ctx.log(
      `local durable cwd re-sign returned no credentials session=${ctx.sessionForMount}`,
    );
    return false;
  }
  ctx.recordResignedCredential("cwd", fresh);
  return mountLocalDurableCwd(ctx, deps, "enotconn-retry");
}

/**
 * React to an ENOTCONN seen in an ACP event by remounting every eligible local mount.
 *
 * Synchronous by design: it starts the remount and stores the promise, so the event handler is
 * never blocked. Teardown awaits `runtimeRemount` FIRST, which is what stops a remount from
 * landing against a half-torn-down environment.
 */
export function remountLocalCwdAfterRuntimeEnotconn(
  ctx: AcquireContext,
  deps: MountDeps,
  event: unknown,
): void {
  const plan = ctx.plan;
  if (plan.isDaytona) return;
  // The event cannot say which mount broke; remount every eligible one (alive mounts no-op).
  const cwdEligible = !!ctx.env.mountCreds && !!ctx.env.mountedCwd;
  const agentEligible = !!ctx.env.agentMountCreds && !!ctx.env.agentMountedPath;
  if (!cwdEligible && !agentEligible) return;
  if (ctx.env.runtimeRemount || !containsTransportEndpointDisconnected(event))
    return;
  ctx.log(
    `local durable mount ENOTCONN observed in ACP event session=${ctx.sessionForMount} cwd=${plan.workspace.cwd}; re-signing and remounting`,
  );
  ctx.setRuntimeRemount(
    (async () => {
      const cwdOk = cwdEligible ? await reSignAndRemountLocalCwd(ctx, deps) : true;
      const agentOk = agentEligible
        ? await reSignAndRemountLocalAgentMount(ctx, deps)
        : true;
      return cwdOk && agentOk;
    })().catch((err) => {
      // No `rethrowIfInvariant` here: this is a detached promise, so a rethrow would become an
      // unhandled rejection rather than failing the acquisition. An ordering violation cannot
      // reach this path anyway — the daemon env is long frozen by the time an ACP event arrives.
      ctx.log(
        `local durable mount runtime remount failed session=${ctx.sessionForMount}: ${conciseError(err, plan.harness)}`,
      );
      return false;
    }),
  );
}
