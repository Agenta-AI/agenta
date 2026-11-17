/**
 * `MountLifecycle` — the session folder's mount, every attached drive's mount, and everything that
 * keeps them alive.
 *
 *  - The DURABLE CWD is the run directory. It is keyed by SESSION, signed with `signMount`, and
 *    its path is the plan's cwd. Teardown must unmount it before deleting anything under it.
 *  - Each ATTACHED DRIVE (`run-drives.ts`) mounts at a SIBLING path of the cwd and is linked into
 *    it. The home drive also carries guidance: it tells the model that durable storage exists.
 *
 * Only the cwd mount participates in the `durableCwdSafeToDelete` handshake, which is why the cwd
 * and the drives have separate functions.
 *
 * Both broad catches in this file call `rethrowIfInvariant(err)` FIRST, so an ordering violation
 * (`AcquireInvariantError`) fails the acquire instead of reading as a mount failure.
 */
import { existsSync, mkdirSync, rmdirSync } from "node:fs";

import { apiBase } from "../apiBase.ts";
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
import {
  isMounted,
  mountStorage,
  unmountStorage,
} from "../engines/sandbox_agent/mount.ts";
import {
  driveSubject,
  linkRunDrive,
  runDriveMountPath,
  seedHomeReadme,
  signRunDrive,
  unlinkRunDrive,
  type RunDrive,
  type signAgentMountCredentials,
  type signMountCredentialsBySlug,
} from "../engines/sandbox_agent/run-drives.ts";
import {
  agentToolsLocalDir,
  localAgentToolsExec,
  relinkAgentTools,
} from "../engines/sandbox_agent/agent-tools-setup.ts";
import {
  uploadSystemPromptToSandbox,
  writeSystemPromptLocal,
} from "../engines/sandbox_agent/pi-assets.ts";
import { containsTransportEndpointDisconnected } from "../engines/sandbox_agent/runtime-policy.ts";
import { throwIfAcquireAborted, waitForAcquire } from "./acquire-abort.ts";
import { rethrowIfInvariant, type AcquireContext } from "./acquire-context.ts";

/** The Pi agent directory inside a Daytona sandbox. Injected so this unit stays import-light. */
export interface MountDeps {
  mountStorage?: typeof mountStorage;
  isMounted?: typeof isMounted;
  unmountStorage?: typeof unmountStorage;
  signMount: (
    sessionId: string,
    opts: { apiBase: string; authorization: string; log: (m: string) => void },
  ) => Promise<
    import("../engines/sandbox_agent/mount.ts").MountCredentials | null
  >;
  /** The legacy route, for a request without `drives`. */
  signAgentMount: typeof signAgentMountCredentials;
  signMountBySlug: typeof signMountCredentialsBySlug;
  /** The remote Pi directory constant, passed in rather than imported. */
  daytonaPiDir: string;
  /** The turn signal that must preempt a mount during environment acquisition. */
  signal?: AbortSignal;
}

/**
 * Tell the model, once, what it has of its home drive: its path when it serves files at
 * `agent-files`, or that it is not available this turn. A run without a home drive is told nothing.
 *
 * The negative case exists because the model's history can contain a session where the folder
 * worked, and only a statement in THIS turn can contradict it.
 *
 * Only Pi takes the segment here: Claude takes it through the session `_meta` and every other
 * harness through the instructions file (`platform-guidance.ts`).
 */
export async function activateHomeDriveGuidance(
  ctx: AcquireContext,
  deps: MountDeps,
  status: { path: string } | "unavailable" | undefined,
): Promise<void> {
  if (!status || ctx.guidanceActive) return;
  ctx.markGuidanceActive();

  const plan = ctx.plan;
  if (!plan.isPi) return;

  ctx.appendAgentMountGuidance(
    composeSystemPromptAppendix([
      status === "unavailable"
        ? agentMountUnavailableAppendix()
        : agentMountAppendix(status.path),
    ]) ?? "",
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
  if (writeRunSystemPromptLocal(ctx)) return;
  // Only the subscription (runtime_provided) path has no agent dir yet; it installs into the same
  // operator mount the first call installed into.
  ctx.setRunAgentDir(ctx.reprepareLocalPiAssets());
}

/**
 * Rewrite this run's Pi prompt files after the mount guidance changed them.
 *
 * A subscription run keeps them in its own per-run dir (`piPromptDir`), because its agent dir is
 * shared with every other session on the connection. Every other local Pi run keeps them in its
 * throwaway agent dir. Returns false when the run has neither dir, and the caller then
 * re-prepares the agent dir.
 */
function writeRunSystemPromptLocal(ctx: AcquireContext): boolean {
  const dir = ctx.env.piPromptDir ?? ctx.env.runAgentDir;
  if (!dir) return false;
  writeSystemPromptLocal(
    dir,
    ctx.plan.prompt.systemPrompt,
    ctx.plan.prompt.appendSystemPrompt,
    ctx.log,
  );
  return true;
}

/** Mount the durable cwd on the local host. Returns whether it is live. */
export async function mountLocalDurableCwd(
  ctx: AcquireContext,
  deps: MountDeps,
  reason: string,
): Promise<boolean> {
  const plan = ctx.plan;
  const creds = ctx.env.mountCreds;
  if (!creds || !plan.driveOnRunner) return false;
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
    // Same rule for the agent's tools link (`<cwd>/.tools` -> local disk): a remount hands back
    // a 0-byte file where it was, while the executables it pointed at still exist. Relink only;
    // never re-run the owner's setup script from a recovery path. First acquire ("initial") has
    // nothing to relink yet: the restore step creates the link after the agent mount.
    if (reason !== "initial") {
      const localDir = agentToolsLocalDir(plan.workspace.cwd, false);
      if (existsSync(localDir)) {
        await relinkAgentTools(
          { cwd: plan.workspace.cwd, localDir },
          localAgentToolsExec,
          { log: ctx.log },
        );
      }
    }
    return true;
  }
  throwIfAcquireAborted(deps.signal);
  // A false result means mountStorage stopped the attempt and CONFIRMED the path detached.
  ctx.markCwdDetachConfirmed();
  return false;
}

/** Options for `mountLocalDrive`. */
export interface MountLocalDriveOptions {
  /**
   * The durable cwd mount, when it runs at the same time as this one. The drive's links live
   * inside the cwd, so linking before the cwd mount is live would put them in the directory the
   * mount then shadows. The mount itself does not wait: the drive is a sibling path, never inside
   * the cwd. A rejected cwd mount skips the links and the README seed; the acquire rethrows that
   * rejection and the teardown unmounts this mount.
   */
  cwdReady?: Promise<unknown>;
  remount?: boolean;
}

/**
 * Mount one drive on the local host and make its links. Returns whether it is live. A failure
 * leaves the run without the drive.
 */
export async function mountLocalDrive(
  ctx: AcquireContext,
  deps: MountDeps,
  drive: RunDrive,
  opts: MountLocalDriveOptions = {},
): Promise<boolean> {
  const plan = ctx.plan;
  const creds = drive.credentials;
  if (!creds || !plan.driveOnRunner) return false;
  const mountPath = runDriveMountPath(plan.workspace.cwd, drive);
  if (drive.mountedPath === mountPath && !opts.remount) return true;
  try {
    // `mountStorage` keeps a live mount as it is, and one left by an earlier environment was made
    // with that environment's access and credentials: detach it first, or do not mount at all.
    const leftover = await waitForAcquire(
      () => (deps.isMounted ?? isMounted)(mountPath, ctx.log),
      deps.signal,
    );
    throwIfAcquireAborted(deps.signal);
    if (
      leftover &&
      !(await (deps.unmountStorage ?? unmountStorage)(mountPath, { log: ctx.log }))
    ) {
      ctx.log(`local drive mount not replaced ${driveSubject(drive)}: the earlier mount did not detach`);
      // Its links would still lead to the earlier mount, which may be writable.
      await unlinkRunDrive(plan.workspace.cwd, drive, { log: ctx.log });
      return false;
    }
    mkdirSync(mountPath, { recursive: true });
    if (
      !(await (deps.mountStorage ?? mountStorage)(mountPath, creds, {
        log: ctx.log,
        signal: deps.signal,
        geesefs: { readOnly: drive.access === "read" },
      }))
    ) {
      // Detach confirmed; the mount point is the empty folder made above.
      ctx.releaseDriveMount(drive);
      rmdirSync(mountPath);
      return false;
    }
    ctx.commitDriveMount(drive, mountPath, creds);
    if (opts.cwdReady && !(await opts.cwdReady.then(() => true, () => false)))
      return true;
    throwIfAcquireAborted(deps.signal);
    if (drive.isHome) await seedHomeReadme(mountPath, { log: ctx.log });
    // Mounted either way, so teardown unmounts it; a failed link only hides it from the model.
    ctx.recordDriveLink(
      drive,
      await linkRunDrive(plan.workspace.cwd, drive, mountPath, { log: ctx.log }),
    );
    return true;
  } catch (err) {
    rethrowIfInvariant(err);
    ctx.log(
      `local drive mount failed ${driveSubject(drive)}: ${conciseError(err, plan.harness)}`,
    );
    return false;
  }
}

/** Re-sign one drive and remount it, from that drive's per-acquire budget. */
export async function reSignAndRemountLocalDrive(
  ctx: AcquireContext,
  deps: MountDeps,
  drive: RunDrive,
): Promise<boolean> {
  const plan = ctx.plan;
  if (!ctx.runCred || !plan.driveOnRunner) return false;
  const mountPath = runDriveMountPath(plan.workspace.cwd, drive);
  if (!ctx.takeRemountBudget(`drive:${mountPath}`)) {
    ctx.log(`local drive mount ENOTCONN remount limit reached ${driveSubject(drive)}`);
    return false;
  }
  ctx.log(`local drive mount ENOTCONN ${driveSubject(drive)}; re-signing and remounting`);
  const fresh = await signRunDrive(
    drive,
    { apiBase: apiBase(), authorization: ctx.runCred, log: ctx.log },
    { signBySlug: deps.signMountBySlug, signAgent: deps.signAgentMount },
  );
  if (!fresh) {
    ctx.log(`local drive mount re-sign returned no credentials ${driveSubject(drive)}`);
    return false;
  }
  ctx.recordResignedDriveCredential(drive, fresh);
  return mountLocalDrive(ctx, deps, drive, { remount: true });
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
  if (!ctx.sessionForMount || !ctx.runCred || !plan.driveOnRunner) return false;
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
  // Only runner-host mounts are remounted here; a sandbox's own mounts are its provider's.
  if (!plan.driveOnRunner) return;
  // The event cannot say which mount broke; remount every eligible one (alive mounts no-op).
  const cwdEligible = !!ctx.env.mountCreds && !!ctx.env.mountedCwd;
  const drivesEligible = ctx.env.drives.filter((d) => !!d.mountedPath);
  if (!cwdEligible && drivesEligible.length === 0) return;
  if (ctx.env.runtimeRemount || !containsTransportEndpointDisconnected(event))
    return;
  ctx.log(
    `local durable mount ENOTCONN observed in ACP event session=${ctx.sessionForMount} cwd=${plan.workspace.cwd}; re-signing and remounting`,
  );
  ctx.setRuntimeRemount(
    (async () => {
      const cwdOk = cwdEligible
        ? await reSignAndRemountLocalCwd(ctx, deps)
        : true;
      let drivesOk = true;
      for (const drive of drivesEligible) {
        if (!(await reSignAndRemountLocalDrive(ctx, deps, drive)))
          drivesOk = false;
      }
      return cwdOk && drivesOk;
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
