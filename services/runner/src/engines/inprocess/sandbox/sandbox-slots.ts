/**
 * Admission for command sandboxes on this runner: how many may be created at once, and how many
 * may be running at once. The sandbox provider's quota is shared (other stacks, other people), so
 * a burst of conversations must queue briefly for a slot, and be refused with a sentence when the
 * wait runs out, instead of turning into a burst of provider failures.
 *
 * A running slot stands for a sandbox that may be running. It goes back only once the sandbox is
 * known to be stopped or gone. When that is not known (a stop or a delete failed, or someone else
 * deletes the sandbox), the slot stays taken as "unresolved" and is reconciled in the background:
 * a check asks the provider from time to time, and the slot goes back once the check confirms it.
 */
import { withPublicCode } from "../../sandbox_agent/errors.ts";

export const SANDBOX_SLOTS_FULL_MESSAGE =
  "This agent service is running as many command sandboxes as it is allowed to right now, so the command did not run. Send it again in a moment.";

export function sandboxSlotsUnresolvedMessage(unresolved: number): string {
  return (
    `This agent service is at its limit of running command sandboxes, and ${unresolved} of them ${unresolved === 1 ? "is a sandbox" : "are sandboxes"} ` +
    "it stopped using whose removal the sandbox provider has not confirmed yet, so the command did not run. Send it again in a few minutes."
  );
}

/** At most one on-demand check of the unresolved slots this often. */
const RECONCILE_EVERY_MS = 2_000;

/** Waits between checks of an unresolved slot; the last one repeats. */
export const DEFAULT_RECONCILE_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

/** One slot, taken until it goes back. */
export interface Slot {
  /** False once the slot went back. */
  readonly held: boolean;
  /** The sandbox is known to be stopped or gone: the slot goes back. Idempotent. */
  release(): void;
  /**
   * Whether the sandbox still runs is not known: keep the slot, and call `settled` from time to
   * time until it answers true (the sandbox is confirmed stopped or gone), then give the slot back.
   */
  unresolved(what: string, settled: () => Promise<boolean>): void;
  /** Its holder uses the sandbox again: stop reconciling. False when the slot already went back. */
  reclaim(): boolean;
}

interface Pending {
  what: string;
  settled: () => Promise<boolean>;
  attempt: number;
  timer: NodeJS.Timeout | undefined;
  checking: boolean;
}

/** A counting semaphore with a bounded, cancellable wait, whose slots can be kept while unresolved. */
export class Slots {
  private used = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly pending = new Map<Slot, Pending>();
  private lastReconcile = 0;

  constructor(
    readonly max: number,
    private readonly reconcileDelaysMs: readonly number[] = DEFAULT_RECONCILE_DELAYS_MS,
    private readonly log: (message: string) => void = () => {},
  ) {}

  get inUse(): number {
    return this.used;
  }

  /** Slots kept for sandboxes not yet confirmed stopped or gone. */
  get unresolved(): number {
    return this.pending.size;
  }

  /** Resolve with a slot once one is free; refuse after `waitMs`. */
  acquire(waitMs: number, signal?: AbortSignal): Promise<Slot> {
    if (this.used < this.max) return Promise.resolve(this.grant());
    if (signal?.aborted) return Promise.reject(new Error("aborted"));
    // Someone waits: check the unresolved slots now rather than on their schedule.
    this.reconcile();
    return new Promise((resolve, reject) => {
      const wake = () => {
        cleanup();
        // Handed over by a release: the slot is ours before anyone else can take it.
        resolve(this.grant());
      };
      const timer = setTimeout(() => {
        cleanup();
        const message = this.pending.size > 0 ? sandboxSlotsUnresolvedMessage(this.pending.size) : SANDBOX_SLOTS_FULL_MESSAGE;
        reject(withPublicCode(new Error(message), "sandbox_capacity"));
      }, waitMs);
      timer.unref?.();
      const onAbort = () => {
        cleanup();
        reject(new Error("aborted"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const at = this.waiting.indexOf(wake);
        if (at >= 0) this.waiting.splice(at, 1);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(wake);
    });
  }

  /**
   * Check every unresolved slot now (at most one check per slot at a time, and one sweep of them
   * every `RECONCILE_EVERY_MS`: many waiters must not multiply the provider calls).
   */
  reconcile(): Promise<void> {
    if (Date.now() - this.lastReconcile < RECONCILE_EVERY_MS) return Promise.resolve();
    this.lastReconcile = Date.now();
    const checks: Promise<void>[] = [];
    for (const [slot, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      checks.push(this.check(slot, entry));
    }
    return Promise.all(checks).then(() => {});
  }

  private grant(): Slot {
    this.used += 1;
    let held = true;
    const slot: Slot = {
      get held() {
        return held;
      },
      release: () => {
        if (!held) return;
        held = false;
        this.forgetPending(slot);
        this.used -= 1;
        this.waiting.shift()?.();
      },
      unresolved: (what, settled) => {
        if (!held) return;
        this.forgetPending(slot);
        const entry: Pending = { what, settled, attempt: 0, timer: undefined, checking: false };
        this.pending.set(slot, entry);
        this.log(`[inprocess] sandbox slot kept until ${what} is confirmed stopped or gone`);
        this.schedule(slot, entry);
      },
      reclaim: () => {
        if (!held) return false;
        this.forgetPending(slot);
        return true;
      },
    };
    return slot;
  }

  private forgetPending(slot: Slot): void {
    const entry = this.pending.get(slot);
    if (entry?.timer) clearTimeout(entry.timer);
    this.pending.delete(slot);
  }

  private schedule(slot: Slot, entry: Pending): void {
    const delays = this.reconcileDelaysMs;
    const delay = delays[Math.min(entry.attempt, delays.length - 1)] ?? 60_000;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.check(slot, entry);
    }, delay);
    entry.timer.unref?.();
  }

  private async check(slot: Slot, entry: Pending): Promise<void> {
    if (entry.checking) return;
    entry.checking = true;
    let settled = false;
    try {
      settled = await entry.settled();
    } catch {
      settled = false;
    } finally {
      entry.checking = false;
    }
    // Reclaimed, released or marked again while the check ran: this entry decides nothing now.
    if (this.pending.get(slot) !== entry) return;
    if (settled) {
      this.log(`[inprocess] sandbox slot given back: ${entry.what} is confirmed stopped or gone`);
      slot.release();
      return;
    }
    entry.attempt += 1;
    if (!entry.timer) this.schedule(slot, entry);
  }
}

export interface SandboxSlots {
  creates: Slots;
  running: Slots;
  /** How long a command waits for a slot before it is refused. */
  waitMs: number;
}

export function sandboxSlots(
  maxCreates: number,
  maxRunning: number,
  waitMs: number,
  options: { reconcileDelaysMs?: readonly number[]; log?: (message: string) => void } = {},
): SandboxSlots {
  return { creates: new Slots(maxCreates), running: new Slots(maxRunning, options.reconcileDelaysMs, options.log), waitMs };
}
