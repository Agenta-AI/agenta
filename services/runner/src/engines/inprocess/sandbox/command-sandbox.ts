/**
 * The command sandbox of one conversation on this runner: a Daytona sandbox that only runs shell
 * commands.
 *
 * Invariants:
 * - Inside a runner process there is one `CommandSandbox` per conversation (the registry owns it),
 *   and it uses only a sandbox this process created, labelled with its runner and deployment
 *   (`sandbox-owner.ts`). When the conversation moves to another runner, that runner creates its
 *   own sandbox and mounts the drive in it; this one is never used by anyone else, so no call
 *   here has to ask who else may be using it. A sandbox left behind by a runner that died is
 *   removed by Daytona's own stop, archive and delete intervals.
 * - Every lifecycle step (bring up, stop, delete) runs in one queue, so a park can never
 *   interleave with a command starting. A stop is skipped while any use is in flight.
 * - A command never runs on a sandbox whose network policy is not the run's policy. A policy
 *   change that failed or timed out leaves the policy unknown (a late update may still land), so
 *   the sandbox is retired: never used again, deleted in the background.
 * - The run's custom sandbox credentials are Daytona environment variables set at create, never
 *   command text. A sandbox created with other credentials is retired, never reused.
 * - A sandbox whose state after an operation is unknown (a command whose end could not be
 *   confirmed, a call that did not answer) is retired the same way. A retired sandbox whose delete
 *   fails is deleted again by its slot's reconciliation (no conversation points at it any more).
 * - Until every sandbox this conversation retired is confirmed gone, no new change starts
 *   (`untilRetiredSettled`): a request sent to one may still land on the drive.
 * - The running slot of a sandbox (`sandbox-slots.ts`) goes back only once the sandbox is known to
 *   be stopped or gone. After a failed stop or delete, the slot stays taken and is reconciled
 *   until the provider confirms it.
 */
import { createHmac } from "node:crypto";
import { abortedError, type CreateSandboxRequest, type DaytonaApi, type DaytonaSandbox, type NetworkSettings } from "./daytona-api.ts";
import { SANDBOX_CAPACITY_MESSAGE, SANDBOX_PROVIDER_CAPACITY, withPublicCode } from "../../sandbox_agent/errors.ts";
import { DEPLOYMENT_LABEL, OWNER_LABEL, type SandboxOwner } from "./sandbox-owner.ts";
import { sandboxSlots, type SandboxSlots, type Slot } from "./sandbox-slots.ts";
import { SerialQueue, sleep, untilAborted } from "./serial-queue.ts";
import { startSandboxMeter, type SandboxMeter, type SandboxUsageContext } from "../../../metering/sandbox-usage.ts";

type Log = (message: string) => void;

export const CONVERSATION_LABEL = "agenta.conversation";
export const CREDENTIALS_LABEL = "agenta.credentials";

export interface CommandSandboxSettings {
  snapshot?: string;
  image?: string;
  /** Operator labels and the provider label, on every sandbox. */
  labels: Record<string, string>;
  /** Stop a running sandbox after this long without a command. */
  idleStopMs: number;
  /** Daytona-side backstops for a runner that dies without cleaning up. */
  autoStopMinutes: number;
  autoDeleteMinutes: number;
  /** This runner's admission for creating and running sandboxes; shared by every conversation. */
  slots?: SandboxSlots;
  /** Keys the credential fingerprint label, so the label cannot be brute-forced back to values. */
  fingerprintKey: string;
  /** Reports running seconds to the wallet; tests replace it. */
  startMeter?: typeof startSandboxMeter;
}

/** What a command needs from the sandbox: the run's network policy and custom credentials. */
export interface SandboxRequirements {
  network: NetworkSettings;
  environment: Record<string, string>;
}

export class SandboxLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxLostError";
  }
}

export class RetiredSandboxUnsettledError extends Error {
  readonly publicCode = "runner_error" as const;
  constructor() {
    super(
      "An earlier command or change to the agent's files may still land, because the command sandbox it ran on is not confirmed deleted yet, so this one did not run. Try again in a few minutes.",
    );
    this.name = "RetiredSandboxUnsettledError";
  }
}

export class NetworkPolicyError extends Error {
  readonly publicCode = "runner_error" as const;
  constructor() {
    super("The run's network policy could not be confirmed on the command sandbox, so the command did not run and the sandbox will be replaced. Send it again.");
    this.name = "NetworkPolicyError";
  }
}

/** One use of the running sandbox. `release` must be called exactly once. */
export interface SandboxUse {
  readonly sandbox: DaytonaSandbox;
  readonly generation: number;
  /**
   * Counts the times this runner created or started the sandbox. Anything that lives only while
   * the sandbox runs (the drive's mounts) must be set up again when it changes.
   */
  readonly boot: number;
  /**
   * Fires when this use's sandbox may no longer be used: it was retired or deleted. Never un-fires.
   */
  readonly signal: AbortSignal;
  /** Why `signal` fired, once it has. */
  readonly lostReason: string | undefined;
  /** False once the sandbox was replaced, retired or deleted since this use began. */
  readonly current: boolean;
  /** Throws when `current` is false. */
  assertCurrent(): void;
  /**
   * The sandbox's state is unknown after a failed operation: never use it again. It is deleted in
   * the background, and no new change starts until the delete is confirmed.
   */
  retire(reason: string): void;
  /** A call failed in a way that may mean the sandbox stopped: check Daytona before the next use. */
  suspect(reason: string): void;
  release(): void;
}

export interface CommandSandboxStats {
  /** The current sandbox, read when the stats are taken. */
  sandboxId?: string;
  creates: number;
  starts: number;
  stops: number;
  commands: number;
  retired: number;
  runningSeconds: number;
  lastStartMs?: number;
}

/** First wait before asking again after a capacity refusal; the jitter adds up to as much again. */
const CAPACITY_RETRY_MS = 3_000;

const STARTABLE = new Set(["stopped", "archived", "paused"]);
/** States in which a sandbox holds no running slot. */
const AT_REST = new Set(["stopped", "archived", "paused", "destroyed"]);
const COMING_UP = new Set(["starting", "restoring", "resuming", "pulling_snapshot", "creating", "pending_build", "building_snapshot"]);
const GOING_DOWN = new Set(["stopping", "archiving", "pausing"]);

export function networkKey(network: NetworkSettings): string {
  if (network.networkBlockAll) return "block";
  return network.networkAllowList ? `allow:${network.networkAllowList}` : "open";
}

const NOT_FOUND = /not found|404/i;

/** Refresh `sandbox`; "gone" when the provider no longer knows it. */
async function observe(sandbox: DaytonaSandbox): Promise<string> {
  try {
    await sandbox.refresh();
  } catch (err) {
    if (NOT_FOUND.test(String(err instanceof Error ? err.message : err))) return "gone";
    throw err;
  }
  return sandbox.state ?? "unknown";
}

/** Confirmed stopped or gone: its running slot may go back. */
async function atRest(sandbox: DaytonaSandbox): Promise<boolean> {
  const state = await observe(sandbox);
  return state === "gone" || AT_REST.has(state);
}

/** Delete `sandbox` once more; true once it is confirmed gone. */
async function removed(sandbox: DaytonaSandbox): Promise<boolean> {
  try {
    await sandbox.remove();
    return true;
  } catch {
    const state = await observe(sandbox);
    return state === "gone" || state === "destroyed";
  }
}


export class CommandSandbox {
  private current: DaytonaSandbox | undefined;
  /** Fires, with the reason, when `current` is retired or deleted. */
  private ended: AbortController | undefined;
  /** We believe `current` is started; false after a stop or a suspicious failure. */
  private believedRunning = false;
  private appliedNetwork: string | undefined;
  /** Sequence number of the last network policy change sent; logged with every change. */
  private networkSeq = 0;
  private readonly lifecycle = new SerialQueue();
  /** Parks and deletes still running; shutdown waits for them. */
  private readonly background = new Set<Promise<void>>();
  private uses = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private runningSince: number | undefined;
  /** The newest holder's usage context; without one, nothing is metered. */
  private usage: SandboxUsageContext | undefined;
  /** Reports the running seconds of `current` while it runs. */
  private meter: SandboxMeter | undefined;
  /** The running slot of `current` (or of the sandbox being created); goes back once it is stopped or gone. */
  private runningSlot: Slot | undefined;
  /** Without a runner-wide admission (tests), an unlimited one: its reconciliation still settles retired sandboxes. */
  private readonly slots: SandboxSlots;
  /** Retired sandboxes not yet confirmed gone: a request sent to one may still land. */
  private readonly unsettled = new Set<Promise<void>>();
  private deleted = false;
  /** Bumped whenever commands start seeing a different disk: create or replace. */
  generation = 0;
  /** Bumped on every create and every start: what runs only while the sandbox runs is gone. */
  boot = 0;
  /** Environments of this conversation holding it (the registry's count). */
  holders = 0;
  lastUsedAt = Date.now();
  readonly stats: CommandSandboxStats = { creates: 0, starts: 0, stops: 0, commands: 0, retired: 0, runningSeconds: 0 };

  constructor(
    readonly key: string,
    private readonly settings: CommandSandboxSettings,
    private readonly api: DaytonaApi,
    private readonly owner: SandboxOwner,
    private readonly conversationLabels: Record<string, string>,
    private readonly log: Log,
  ) {
    this.slots = settings.slots ?? sandboxSlots(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 30_000);
  }

  get sandboxId(): string | undefined {
    return this.current?.id;
  }

  get inUse(): boolean {
    return this.uses > 0;
  }

  /** A sandbox of this conversation is started (as far as this runner knows). */
  get running(): boolean {
    return this.runningSince !== undefined;
  }

  /** The running sandbox, with the run's network policy and credentials. */
  async acquire(requirements: SandboxRequirements, signal?: AbortSignal): Promise<SandboxUse> {
    if (signal?.aborted) throw abortedError();
    this.uses += 1;
    this.cancelIdleStop();
    let sandbox: DaytonaSandbox;
    try {
      sandbox = await untilAborted(this.lifecycle.run(() => this.bringUp(requirements, signal)), signal);
    } catch (err) {
      this.endUse();
      throw err;
    }
    const generation = this.generation;
    const boot = this.boot;
    const ended = this.ended!.signal;
    const isCurrent = () => this.generation === generation && this.current === sandbox && !ended.aborted;
    let released = false;
    return {
      sandbox,
      generation,
      boot,
      signal: ended,
      get lostReason() {
        return ended.aborted ? String(ended.reason) : undefined;
      },
      get current() {
        return isCurrent();
      },
      assertCurrent: () => {
        if (!isCurrent()) throw new SandboxLostError("The command sandbox was replaced while the command was being prepared.");
      },
      retire: (reason) => this.retire(sandbox, reason),
      suspect: (reason) => {
        if (this.current !== sandbox) return;
        this.log(`[inprocess] sandbox ${sandbox.id} suspect: ${reason}`);
        this.believedRunning = false;
      },
      release: () => {
        if (released) return;
        released = true;
        this.endUse();
      },
    };
  }

  /** The newest run's usage context: the meter reports with its credential from now on. */
  useUsage(usage: SandboxUsageContext | undefined): void {
    if (!usage?.authorization) return;
    this.usage = usage;
    this.meter?.setAuthorization(usage.authorization);
  }

  countCommand(): void {
    this.stats.commands += 1;
  }

  private endUse(): void {
    this.uses = Math.max(0, this.uses - 1);
    this.lastUsedAt = Date.now();
    if (this.uses > 0) return;
    // Parked while this use ran: the park skipped the stop, so it happens now.
    if (this.holders === 0) this.inBackground(this.stop("parked"));
    else this.scheduleIdleStop();
  }

  private inBackground(work: Promise<void>): Promise<void> {
    const tracked = work.catch((err) => this.log(`[inprocess] sandbox background step failed: ${String(err).slice(0, 160)}`));
    this.background.add(tracked);
    void tracked.finally(() => this.background.delete(tracked));
    return tracked;
  }

  // ---- Bringing up ------------------------------------------------------------------------ //

  private async bringUp(requirements: SandboxRequirements, signal?: AbortSignal): Promise<DaytonaSandbox> {
    try {
      return await this.bringUpOnce(requirements, signal);
    } catch (err) {
      // No sandbox of this conversation exists after all: the slot goes back. When one exists it
      // may be running, and its slot stays until a stop or a delete settles it.
      if (!this.current) this.releaseSlot();
      throw err;
    }
  }

  /**
   * The running slot, taken before anything is started. The slot this conversation still holds
   * for its sandbox is taken back (it may have been waiting on reconciliation after a failed stop).
   */
  private async takeSlot(signal?: AbortSignal): Promise<void> {
    if (this.runningSlot?.reclaim()) return;
    this.runningSlot = await this.slots.running.acquire(this.slots.waitMs, signal);
  }

  private releaseSlot(): void {
    const slot = this.runningSlot;
    this.runningSlot = undefined;
    slot?.release();
  }

  private async bringUpOnce(requirements: SandboxRequirements, signal?: AbortSignal): Promise<DaytonaSandbox> {
    if (this.deleted) throw new SandboxLostError("The command sandbox was deleted.");
    const t0 = Date.now();
    const fingerprint = this.fingerprint(requirements.environment);
    if (this.current && this.current.labels[CREDENTIALS_LABEL] !== fingerprint) {
      this.retire(this.current, "the run's sandbox credentials changed");
    }
    if (this.current && !this.believedRunning) {
      await this.takeSlot(signal);
      try {
        await this.revive(this.current, signal);
      } catch (err) {
        if (signal?.aborted) throw err;
        this.retire(this.current, `it could not be resumed: ${String(err).slice(0, 120)}`);
      }
    }
    if (!this.current) {
      await this.takeSlot(signal);
      await this.create(requirements, fingerprint, signal);
    }
    const sandbox = this.current!;
    await this.applyNetwork(sandbox, requirements.network);
    this.markRunning(t0);
    this.stats.lastStartMs = Date.now() - t0;
    return sandbox;
  }

  /** Get `sandbox` to `started` from whatever state Daytona reports. Throws when it cannot. */
  private async revive(sandbox: DaytonaSandbox, signal?: AbortSignal): Promise<void> {
    await sandbox.refresh(signal);
    const settleBy = Date.now() + 120_000;
    while (GOING_DOWN.has(sandbox.state ?? "") && Date.now() < settleBy) {
      await sleep(1_000, signal);
      await sandbox.refresh(signal);
    }
    while (COMING_UP.has(sandbox.state ?? "") && Date.now() < settleBy) {
      await sleep(1_000, signal);
      await sandbox.refresh(signal);
    }
    const state = sandbox.state ?? "unknown";
    if (state !== "started") {
      if (!STARTABLE.has(state)) throw new SandboxLostError(`sandbox state is ${state}`);
      await sandbox.start(signal);
      this.boot += 1;
      this.stats.starts += 1;
    }
    this.believedRunning = true;
  }

  private async create(requirements: SandboxRequirements, fingerprint: string, signal?: AbortSignal): Promise<void> {
    const t0 = Date.now();
    const raw = await this.createWithRetry(
      {
        ...(this.settings.image
          ? { image: this.settings.image }
          : { snapshot: this.settings.snapshot }),
        labels: {
          ...this.settings.labels,
          ...this.conversationLabels,
          [CREDENTIALS_LABEL]: fingerprint,
          [OWNER_LABEL]: this.owner.id,
          [DEPLOYMENT_LABEL]: this.owner.deployment,
        },
        // Invariant: only the run's own custom credentials; never model keys or runner settings.
        envVars: requirements.environment,
        network: requirements.network,
        autoStopMinutes: this.settings.autoStopMinutes,
        autoDeleteMinutes: this.settings.autoDeleteMinutes,
      },
      signal,
    );
    this.current = raw;
    this.ended = new AbortController();
    this.believedRunning = true;
    this.appliedNetwork = networkKey(requirements.network);
    this.generation += 1;
    this.boot += 1;
    this.stats.creates += 1;
    this.log(`[inprocess] sandbox created key=${this.key} id=${raw.id} ms=${Date.now() - t0}`);
  }

  /**
   * One create, under this runner's create slot. A refusal for the provider's capacity or quota
   * created nothing, so it is asked once more after a short, jittered wait; a second refusal reads
   * as a plain sentence (the provider's own text sells an upgrade and links its dashboard).
   */
  private async createWithRetry(request: CreateSandboxRequest, signal?: AbortSignal): Promise<DaytonaSandbox> {
    const slot = await this.slots.creates.acquire(this.slots.waitMs, signal);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.api.create(request, signal);
        } catch (err) {
          if (!SANDBOX_PROVIDER_CAPACITY.test(String(err instanceof Error ? err.message : err))) throw err;
          this.log(`[inprocess] sandbox create refused for capacity (attempt ${attempt + 1})`);
          if (attempt >= 1) throw withPublicCode(new Error(SANDBOX_CAPACITY_MESSAGE), "sandbox_capacity");
          await sleep(CAPACITY_RETRY_MS + Math.floor(Math.random() * CAPACITY_RETRY_MS), signal);
        }
      }
    } finally {
      slot.release();
    }
  }

  private async applyNetwork(sandbox: DaytonaSandbox, network: NetworkSettings): Promise<void> {
    const wanted = networkKey(network);
    if (this.appliedNetwork === wanted) return;
    const seq = (this.networkSeq += 1);
    try {
      await sandbox.updateNetwork(network);
    } catch (err) {
      // The change may still land later, in any order with a newer one: the policy is unknown.
      const cause = String(err instanceof Error ? err.message : err).slice(0, 160);
      this.retire(sandbox, `network policy change #${seq} (${wanted}) was not confirmed: ${cause}`);
      throw new NetworkPolicyError();
    }
    this.appliedNetwork = wanted;
    this.log(`[inprocess] sandbox ${sandbox.id} network policy #${seq} is now ${wanted}`);
  }

  private fingerprint(environment: Record<string, string>): string {
    const names = Object.keys(environment).sort();
    if (names.length === 0) return "none";
    const canonical = JSON.stringify(names.map((n) => [n, environment[n]]));
    return createHmac("sha256", this.settings.fingerprintKey).update(canonical).digest("hex").slice(0, 32);
  }

  // ---- Stopping, deleting, retiring -------------------------------------------------------- //

  private cancelIdleStop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private scheduleIdleStop(): void {
    this.cancelIdleStop();
    this.idleTimer = setTimeout(() => void this.stop("idle"), this.settings.idleStopMs);
    this.idleTimer.unref?.();
  }

  /**
   * Stop without deleting, keeping the disk for this runner's next command. Skipped while a use is
   * in flight or queued. The running slot goes back only once the sandbox is known to be stopped.
   */
  stop(why: string): Promise<void> {
    return this.lifecycle.run(async () => {
      if (this.uses > 0) return;
      const sandbox = this.current;
      if (!sandbox) return;
      if (!this.believedRunning) {
        // A failure made it suspect and nothing revived it: it may run or not, so ask Daytona.
        this.runningSlot?.unresolved(`sandbox ${sandbox.id}`, () => atRest(sandbox));
        return;
      }
      const t0 = Date.now();
      this.believedRunning = false;
      this.markStopped();
      try {
        await sandbox.stop();
        this.stats.stops += 1;
        this.log(`[inprocess] sandbox stopped (${why}) id=${sandbox.id} ms=${Date.now() - t0}`);
        this.releaseSlot();
      } catch (err) {
        // Whether it stopped is unknown: its slot stays until Daytona says so, and the next command checks Daytona first.
        this.log(`[inprocess] sandbox stop failed id=${sandbox.id}: ${String(err).slice(0, 160)}`);
        this.runningSlot?.unresolved(`sandbox ${sandbox.id}`, () => atRest(sandbox));
      }
    });
  }

  /** Delete the sandbox for good. Nothing can use this object afterwards. */
  delete(): Promise<void> {
    return this.lifecycle.run(async () => {
      this.cancelIdleStop();
      this.deleted = true;
      const { sandbox, slot } = this.detach("the conversation's sandbox was deleted");
      if (!sandbox) return slot?.release();
      try {
        await sandbox.remove();
        this.log(`[inprocess] sandbox deleted id=${sandbox.id}`);
        slot?.release();
      } catch (err) {
        // No conversation points at it any more: its slot stays until a retry deletes it.
        this.log(`[inprocess] sandbox delete failed id=${sandbox.id}: ${String(err).slice(0, 160)}`);
        slot?.unresolved(`deleted sandbox ${sandbox.id}`, () => removed(sandbox));
      }
    });
  }

  /**
   * Never use `sandbox` again, and delete it in the background. Its running slot stays taken until
   * the delete is confirmed, so a replacement never runs beside it past the runner's cap; a delete
   * that fails keeps the slot until a retry (or the sweep) deletes it. New changes wait for that
   * confirmation (`untilRetiredSettled`).
   */
  private retire(sandbox: DaytonaSandbox, reason: string): void {
    if (this.current !== sandbox) return;
    this.log(`[inprocess] sandbox ${sandbox.id} retired: ${reason}`);
    const { slot } = this.detach(`the command sandbox was retired: ${reason}`);
    this.stats.retired += 1;
    this.settleInBackground(
      slot,
      `retired sandbox ${sandbox.id}`,
      () => removed(sandbox),
      sandbox.remove().then(
        () => this.log(`[inprocess] retired sandbox ${sandbox.id} deleted`),
        (err) => {
          this.log(`[inprocess] retired sandbox ${sandbox.id} not deleted yet (retried until it is): ${String(err).slice(0, 120)}`);
          throw err;
        },
      ),
    );
  }

  /**
   * Track a sandbox this conversation stopped using until `first` (when given) succeeds or
   * `settled` confirms it; its slot goes back then. A sandbox with no running slot is already at rest.
   */
  private settleInBackground(slot: Slot | undefined, what: string, settled: () => Promise<boolean>, first?: Promise<void>): void {
    if (!slot) return;
    const done = new Promise<void>((resolve) => {
      const reconcile = () =>
        slot.unresolved(what, async () => {
          const ok = await settled();
          if (ok) resolve();
          return ok;
        });
      if (!first) return reconcile();
      void this.inBackground(
        first.then(
          () => {
            slot.release();
            resolve();
          },
          reconcile,
        ),
      );
    });
    this.unsettled.add(done);
    void done.then(() => this.unsettled.delete(done));
  }

  /**
   * Resolves once every sandbox this conversation retired is confirmed gone,
   * so nothing sent to one can still land. Refuses with a sentence after the slot wait.
   */
  async untilRetiredSettled(signal?: AbortSignal): Promise<void> {
    if (this.unsettled.size === 0) return;
    void this.slots.running.reconcile();
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), this.slots.waitMs)));
    try {
      const settled = await untilAborted(Promise.race([Promise.all(this.unsettled).then(() => true), expired]), signal);
      if (!settled) throw new RetiredSandboxUnsettledError();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Forget the current sandbox, end every use of it, and hand over its slot. */
  private detach(reason: string): { sandbox: DaytonaSandbox | undefined; slot: Slot | undefined } {
    const sandbox = this.current;
    const slot = this.runningSlot;
    this.current = undefined;
    this.runningSlot = undefined;
    this.believedRunning = false;
    this.appliedNetwork = undefined;
    this.markStopped();
    this.ended?.abort(reason);
    this.ended = undefined;
    return { sandbox, slot };
  }

  /** Wait (bounded) for parks and deletes still running. */
  async settle(timeoutMs: number): Promise<void> {
    await Promise.race([Promise.allSettled([...this.background]), sleep(timeoutMs)]);
  }

  // ---- Accounting ------------------------------------------------------------------------- //

  private markRunning(since: number): void {
    this.runningSince ??= since;
    if (this.meter || !this.usage || !this.current) return;
    this.meter = (this.settings.startMeter ?? startSandboxMeter)({
      provider: "daytona",
      sandboxId: this.current.id,
      resources: this.current.resources,
      authorization: this.usage.authorization,
      ...(this.usage.sessionId ? { sessionId: this.usage.sessionId } : {}),
      ...(this.usage.agentId ? { agentId: this.usage.agentId } : {}),
      startedAtMs: this.runningSince,
    });
  }

  private markStopped(): void {
    const meter = this.meter;
    this.meter = undefined;
    if (meter) void this.inBackground(meter.stop());
    if (this.runningSince === undefined) return;
    this.stats.runningSeconds += (Date.now() - this.runningSince) / 1000;
    this.runningSince = undefined;
  }

  snapshotStats(): CommandSandboxStats {
    const live = this.runningSince !== undefined ? (Date.now() - this.runningSince) / 1000 : 0;
    return { ...this.stats, sandboxId: this.current?.id, runningSeconds: Math.round(this.stats.runningSeconds + live) };
  }

  /** Stop timers; used when the registry drops the entry. */
  dispose(): void {
    this.cancelIdleStop();
  }
}
