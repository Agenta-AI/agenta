/**
 * Sandbox seconds on the platform's own provider account, measured from outside the sandbox and
 * reported to the platform's wallet.
 *
 * Two calls, both authenticated with the run's own platform credential:
 * - `admitSandboxTurn` asks, before a turn that may run a sandbox starts, whether the caller's
 *   wallet can still spend. Only a clear "no" refuses; anything else admits, because a metering
 *   outage must not stop agents.
 * - `startSandboxMeter` reports every interval the sandbox runs: one per minute, and the final
 *   partial one when it stops. A crash loses at most the interval in progress. Each interval is
 *   whole seconds and names its sandbox and start second, so a retried report is the same
 *   measurement on the platform and is charged once.
 *
 * The platform answers 404 when it does not meter sandboxes (OSS, or the wallet off): the turn is
 * admitted and the meter goes quiet.
 */
import { apiBase } from "../apiBase.ts";
import type { RunErrorCode } from "../engines/sandbox_agent/errors.ts";

export const SANDBOX_USAGE_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
/** How long a stopping meter keeps retrying its last intervals before it gives them up. */
const FINAL_FLUSH_BUDGET_MS = 5_000;
/** The provider's SDK waits a day for an answer; a size that has not arrived by now is unknown. */
const RESOURCES_TIMEOUT_MS = 10_000;
const FINAL_FLUSH_RETRY_MS = 500;
/** Three hours of intervals: past that, a platform that is still down loses the oldest. */
const MAX_PENDING_INTERVALS = 180;

export const WALLET_BALANCE_EXHAUSTED_CODE: RunErrorCode = "wallet_balance_exhausted";
export const WALLET_BALANCE_EXHAUSTED_MESSAGE =
  "Your Agenta credits are used up, so this turn did not start. Add credits to keep going.";

export interface SandboxResources {
  vcpu: number;
  memoryGib: number;
}

/**
 * Used only when the provider does not report a sandbox's size: the size our snapshot runs on
 * Daytona (2 vCPU, 4 GiB, read from a live sandbox on 2026-09-26).
 */
export const DEFAULT_SANDBOX_RESOURCES: SandboxResources = { vcpu: 2, memoryGib: 4 };

type Log = (message: string) => void;
type Fetch = typeof fetch;

const defaultLog: Log = (message) => process.stderr.write(`[sandbox-usage] ${message}\n`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SandboxAdmission = "admitted" | "refused";

/** Whether the caller's wallet admits a turn that may run a platform sandbox. */
export async function admitSandboxTurn(
  authorization: string,
  deps: { fetch?: Fetch; baseUrl?: string; log?: Log } = {},
): Promise<SandboxAdmission> {
  const log = deps.log ?? defaultLog;
  if (!authorization) return "admitted";
  try {
    const res = await (deps.fetch ?? fetch)(
      `${deps.baseUrl ?? apiBase()}/wallets/sandboxes/admit`,
      {
        method: "POST",
        headers: { authorization },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (res.status === 404) return "admitted";
    if (!res.ok) {
      log(`admission HTTP ${res.status}; admitting`);
      return "admitted";
    }
    const body = (await res.json()) as { allowed?: unknown };
    return body.allowed === false ? "refused" : "admitted";
  } catch (err) {
    log(`admission failed; admitting: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
    return "admitted";
  }
}

/** Who a sandbox's time is reported for: the newest run that holds it. */
export interface SandboxUsageContext {
  authorization: string;
  sessionId?: string;
  agentId?: string;
}

export interface SandboxMeterOptions {
  provider: "daytona";
  sandboxId: string;
  /** What the sandbox has, read from the provider. Unknown (undefined or a rejection) meters the default. */
  resources: SandboxResources | Promise<SandboxResources> | undefined;
  /** The current platform credential; its owner keeps it fresh for as long as the sandbox can run. */
  credential: () => string;
  sessionId?: string;
  agentId?: string;
  /** When the sandbox started running; defaults to now. */
  startedAtMs?: number;
  intervalMs?: number;
  now?: () => number;
  fetch?: Fetch;
  baseUrl?: string;
  log?: Log;
}

export interface SandboxMeter {
  /**
   * The sandbox stopped now: report the final partial interval and anything not yet reported,
   * within a bounded time. Never throws.
   */
  stop(): Promise<void>;
}

interface Interval {
  start: number;
  end: number;
}

type Outcome = "reported" | "dropped" | "retry" | "unmetered";

export function startSandboxMeter(options: SandboxMeterOptions): SandboxMeter {
  const now = options.now ?? Date.now;
  const log = options.log ?? defaultLog;
  const doFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? apiBase();
  const unknownSize = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), RESOURCES_TIMEOUT_MS).unref?.();
  });
  const resources = Promise.race([Promise.resolve(options.resources), unknownSize])
    .then((size) => {
      if (!size) throw new Error("the provider reported no size");
      return wholeResources(size);
    })
    .catch((err: unknown) => {
      log(
        `sandbox=${options.sandboxId} size unknown, metering ${DEFAULT_SANDBOX_RESOURCES.vcpu} vCPU / ` +
          `${DEFAULT_SANDBOX_RESOURCES.memoryGib} GiB: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`,
      );
      return DEFAULT_SANDBOX_RESOURCES;
    });
  const agentId = options.agentId && UUID.test(options.agentId) ? options.agentId : undefined;
  const sessionId = options.sessionId && options.sessionId.length <= 128 ? options.sessionId : undefined;

  // Bounds are floored to whole seconds, so consecutive running periods of one sandbox never
  // overlap: at most one second per running period goes unbilled.
  let cursor = Math.floor((options.startedAtMs ?? now()) / 1000);
  let pending: Interval[] = [];
  let unmetered = false;
  let stopped = false;
  // One report in flight at a time, in order.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  /** Close the open interval at `until` (epoch seconds), or at now. */
  const cut = (until?: number): void => {
    const end = until ?? Math.floor(now() / 1000);
    if (unmetered || end <= cursor) return;
    pending.push({ start: cursor, end });
    cursor = end;
    if (pending.length > MAX_PENDING_INTERVALS) {
      const lost = pending.splice(0, pending.length - MAX_PENDING_INTERVALS);
      log(`sandbox=${options.sandboxId} ${lost.length} unreported interval(s) dropped: the platform did not answer`);
    }
  };

  const report = async (interval: Interval): Promise<Outcome> => {
    const size = await resources;
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/wallets/sandboxes/usage`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: options.credential() },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          provider: options.provider,
          sandbox_id: options.sandboxId,
          start_time: new Date(interval.start * 1000).toISOString(),
          end_time: new Date(interval.end * 1000).toISOString(),
          vcpu: size.vcpu,
          memory_gib: size.memoryGib,
          ...(sessionId ? { session_id: sessionId } : {}),
          ...(agentId ? { agent_id: agentId } : {}),
        }),
      });
    } catch {
      return "retry";
    }
    if (res.ok) return "reported";
    if (res.status === 404) return "unmetered";
    if (res.status === 401 || res.status === 403 || res.status === 408 || res.status === 429 || res.status >= 500) {
      return "retry";
    }
    // The platform refused this interval as it is; the same bytes would be refused again.
    log(`sandbox=${options.sandboxId} interval ${interval.start}-${interval.end} refused: HTTP ${res.status}`);
    return "dropped";
  };

  /** True once nothing is left to report. */
  const flush = async (): Promise<boolean> => {
    while (pending.length > 0) {
      const outcome = await report(pending[0]!);
      if (outcome === "retry") return false;
      if (outcome === "unmetered") {
        unmetered = true;
        pending = [];
        clearInterval(timer);
        return true;
      }
      pending.shift();
    }
    return true;
  };

  const timer = setInterval(() => {
    void serial(async () => {
      if (stopped) return;
      cut();
      await flush();
    });
  }, options.intervalMs ?? SANDBOX_USAGE_INTERVAL_MS);
  timer.unref?.();

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // Read now, not when the queue gets here: a report in flight must not stretch the last
      // interval past the stop, or into the next running period of the same sandbox.
      const stoppedAt = Math.floor(now() / 1000);
      const deadline = now() + FINAL_FLUSH_BUDGET_MS;
      const finalFlush = serial(async () => {
        cut(stoppedAt);
        while (!(await flush()) && now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, FINAL_FLUSH_RETRY_MS));
        }
        if (pending.length > 0) {
          const seconds = pending.reduce((total, interval) => total + interval.end - interval.start, 0);
          log(`sandbox=${options.sandboxId} ${seconds}s of running time not reported: the platform did not answer`);
        }
      }).catch(() => {});
      // Teardown waits for the report, not for a report stuck behind a slow one.
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        finalFlush,
        new Promise<void>((resolve) => {
          giveUp = setTimeout(resolve, FINAL_FLUSH_BUDGET_MS + REQUEST_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(giveUp);
    },
  };
}

/** The platform prices whole vCPUs and GiB; a fractional size is billed as the next whole one. */
function wholeResources(size: SandboxResources): SandboxResources {
  const vcpu = Math.ceil(size.vcpu);
  const memoryGib = Math.ceil(size.memoryGib);
  if (!(vcpu >= 1) || !(memoryGib >= 1)) throw new Error(`implausible sandbox size ${JSON.stringify(size)}`);
  return { vcpu, memoryGib };
}
