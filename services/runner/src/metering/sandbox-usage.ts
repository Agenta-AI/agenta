/**
 * Sandbox seconds on the platform's own provider account, measured from outside the sandbox and
 * reported to the platform's wallet.
 *
 * Nothing here runs unless the deployment meters sandboxes: `AGENTA_WALLETS_ENABLED`, the same
 * switch the API's wallet reads. Off, no turn asks for admission and no meter or credential lease
 * starts, so an OSS or wallet-off deployment pays nothing for this.
 *
 * Every call is authenticated twice: the runner token proves the runner is reporting, and the
 * run's own platform credential names the payer.
 * - `admitSandboxTurn` asks, before a turn that may run a sandbox starts, whether the caller's
 *   wallet can still spend and its organization runs fewer turns than its plan allows. The answer
 *   carries the plan's turn limit. Only a clear "no" refuses; anything else admits, because a
 *   metering outage must not stop agents.
 * - `holdTurnSlot` keeps the turn in its organization's count of running turns while it runs.
 * - `startSandboxMeter` reports every interval the sandbox runs while one of its session's turns
 *   runs: one per minute, and the final partial one when the turn ends or the sandbox stops. Warm
 *   time between turns is not billed. A crash loses at most the interval in progress. Each
 *   interval is whole seconds and names its sandbox and start second, so a retried report is the
 *   same measurement on the platform and is charged once.
 *
 * A platform that answers 404 (the runner's switch is on and the API's is off) admits the turn,
 * and the meter goes quiet and gives back its credential lease.
 */
import { apiBase } from "../apiBase.ts";
import type { RunErrorCode } from "../engines/sandbox_agent/errors.ts";
import type { TurnLimit } from "../engines/sandbox_agent/run-limits.ts";
import { platformCredentialForRequest } from "../engines/sandbox_agent/runtime-policy.ts";
import type { AgentRunRequest } from "../protocol.ts";
import { startPlatformCredentialLease, type PlatformCredentialLease } from "../sessions/auth.ts";

export const SANDBOX_USAGE_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
/** How long a stopping meter keeps retrying its last intervals before it gives them up. */
const FINAL_FLUSH_BUDGET_MS = 5_000;
/** The provider's SDK waits a day for an answer; a size that has not arrived by now is unknown. */
const RESOURCES_TIMEOUT_MS = 10_000;
const FINAL_FLUSH_RETRY_MS = 500;
/** Three hours of intervals: past that, a platform that is still down loses the oldest. */
const MAX_PENDING_INTERVALS = 180;

/** Every running turn the platform counts beats this often; its hold lasts three beats. */
export const TURN_SLOT_HEARTBEAT_MS = 60_000;

export const WALLET_BALANCE_EXHAUSTED_CODE: RunErrorCode = "wallet_balance_exhausted";
export const CONCURRENT_TURNS_LIMIT_CODE: RunErrorCode = "concurrent_turns_limit";
/** Used only when a refusal states no message of its own. */
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

const TRUTHY = new Set(["true", "1", "t", "y", "yes", "on", "enable", "enabled"]);

/** Whether this deployment meters sandboxes. Read per call, as the API reads its own switch. */
export function sandboxMeteringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUTHY.has((env.AGENTA_WALLETS_ENABLED ?? "").trim().toLowerCase());
}

/** The credential a run's sandbox is metered with; empty when nothing is metered. */
export function meteringCredentialForRequest(request: AgentRunRequest): string {
  return sandboxMeteringEnabled() ? platformCredentialForRequest(request) : "";
}

/** Who a run's command sandbox reports for, or undefined when nothing is metered. */
export function sandboxUsageContext(
  request: AgentRunRequest,
  sessionId: string | undefined,
): SandboxUsageContext | undefined {
  const authorization = meteringCredentialForRequest(request);
  if (!authorization) return undefined;
  const agentId = request.runContext?.workflow?.artifact?.id;
  return {
    authorization,
    ...(sessionId ? { sessionId } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

function platformHeaders(authorization: string): Record<string, string> {
  const runnerToken = process.env.AGENTA_RUNNER_TOKEN?.trim();
  return { authorization, ...(runnerToken ? { "x-agenta-runner-token": runnerToken } : {}) };
}

/** What the platform answered for a turn that may run a platform sandbox. */
export type SandboxTurnAdmission =
  | {
      admitted: true;
      /** The plan's longest turn; absent where the platform states none. */
      turnLimit?: TurnLimit;
      /** The platform counts this turn against the organization's running turns. */
      slotHeld?: boolean;
    }
  | { admitted: false; code: RunErrorCode; message: string };

const ADMITTED: SandboxTurnAdmission = { admitted: true };

const REFUSAL_CODES = new Set<RunErrorCode>([WALLET_BALANCE_EXHAUSTED_CODE, CONCURRENT_TURNS_LIMIT_CODE]);

interface AdmissionBody {
  allowed?: unknown;
  code?: unknown;
  message?: unknown;
  turn_limit?: { seconds?: unknown; message?: unknown } | null;
  slot_held?: unknown;
}

function readAdmission(body: AdmissionBody): SandboxTurnAdmission {
  if (body.allowed === false) {
    const code = REFUSAL_CODES.has(body.code as RunErrorCode)
      ? (body.code as RunErrorCode)
      : WALLET_BALANCE_EXHAUSTED_CODE;
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim().split("\n")[0]!
        : WALLET_BALANCE_EXHAUSTED_MESSAGE;
    return { admitted: false, code, message };
  }
  const seconds = body.turn_limit?.seconds;
  const limitMessage = body.turn_limit?.message;
  const turnLimit =
    typeof seconds === "number" && seconds > 0 && typeof limitMessage === "string" && limitMessage.trim()
      ? { ms: Math.floor(seconds * 1000), message: limitMessage.trim().split("\n")[0]! }
      : undefined;
  return {
    admitted: true,
    ...(turnLimit ? { turnLimit } : {}),
    ...(body.slot_held === true ? { slotHeld: true } : {}),
  };
}

/**
 * Whether the platform admits a turn that may run a platform sandbox: the caller's wallet can
 * still spend, and its organization runs fewer turns at once than its plan allows. Only a clear
 * "no" refuses; anything else admits, because a metering outage must not stop agents.
 */
export async function admitSandboxTurn(
  authorization: string,
  turnId: string,
  deps: { fetch?: Fetch; baseUrl?: string; log?: Log } = {},
): Promise<SandboxTurnAdmission> {
  const log = deps.log ?? defaultLog;
  if (!authorization) return ADMITTED;
  try {
    const res = await (deps.fetch ?? fetch)(
      `${deps.baseUrl ?? apiBase()}/wallets/sandboxes/admit`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...platformHeaders(authorization) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({ turn_id: turnId }),
      },
    );
    if (res.status === 404) return ADMITTED;
    if (!res.ok) {
      log(`admission HTTP ${res.status}; admitting`);
      return ADMITTED;
    }
    return readAdmission((await res.json()) as AdmissionBody);
  } catch (err) {
    log(`admission failed; admitting: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
    return ADMITTED;
  }
}

/** The platform's hold on one running turn; let go of it once when the turn ends. */
export interface TurnSlot {
  release(): void;
}

/**
 * Keep the platform's count of this organization's running turns true while the turn runs: a
 * beat every interval, and a release at the end. A runner that dies stops beating, so its turns
 * leave the count on their own once the platform's hold expires. A failed beat or release is
 * logged and never touches the turn.
 */
export function holdTurnSlot(
  authorization: string,
  turnId: string,
  deps: {
    fetch?: Fetch;
    baseUrl?: string;
    log?: Log;
    intervalMs?: number;
    startLease?: (authorization: string) => PlatformCredentialLease;
  } = {},
): TurnSlot {
  const log = deps.log ?? defaultLog;
  const doFetch = deps.fetch ?? fetch;
  const baseUrl = deps.baseUrl ?? apiBase();
  const lease = (deps.startLease ?? ((value: string) => startPlatformCredentialLease(baseUrl, value)))(authorization);
  const post = async (action: "heartbeat" | "release"): Promise<void> => {
    try {
      const res = await doFetch(`${baseUrl}/wallets/sandboxes/turns/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...platformHeaders(lease.credential()) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({ turn_id: turnId }),
      });
      if (!res.ok) log(`turn ${action} HTTP ${res.status}`);
    } catch (err) {
      log(`turn ${action} failed: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
    }
  };
  const timer = setInterval(() => void post("heartbeat"), deps.intervalMs ?? TURN_SLOT_HEARTBEAT_MS);
  timer.unref?.();
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      clearInterval(timer);
      void post("release").finally(() => lease.release());
    },
  };
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
  /**
   * Reads what the sandbox has from the provider. Called once by a started meter, which owns the
   * failure: unknown (undefined, a throw or a rejection) meters the default.
   */
  resources: () => SandboxResources | Promise<SandboxResources> | undefined;
  /** The current platform credential; its owner keeps it fresh for as long as the sandbox can run. */
  credential: () => string;
  sessionId?: string;
  agentId?: string;
  /** Called once if the platform turns out not to meter sandboxes, so the credential is let go. */
  onUnmetered?: () => void;
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

/** A meter of one session's sandbox, which runs only while one of that session's turns runs. */
interface SessionMeter {
  pause(): void;
  resume(): void;
}

const runningTurns = new Map<string, number>();
const sessionMeters = new Map<string, Set<SessionMeter>>();

/**
 * A turn of this session started: its sandboxes are billed until the returned function is called.
 *
 * Only running turns are billed. A sandbox kept warm after a turn, or waiting for a person to
 * answer an approval, keeps running on the provider's account, but its time between turns is not
 * charged. A run without a session has no warm window: its meter runs until its sandbox stops.
 */
export function beginMeteredTurn(sessionId: string | undefined): () => void {
  if (!sessionId) return () => {};
  runningTurns.set(sessionId, (runningTurns.get(sessionId) ?? 0) + 1);
  for (const meter of sessionMeters.get(sessionId) ?? []) meter.resume();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const left = (runningTurns.get(sessionId) ?? 1) - 1;
    if (left > 0) {
      runningTurns.set(sessionId, left);
      return;
    }
    runningTurns.delete(sessionId);
    for (const meter of sessionMeters.get(sessionId) ?? []) meter.pause();
  };
}

function watchSession(sessionId: string, meter: SessionMeter): () => void {
  let meters = sessionMeters.get(sessionId);
  if (!meters) {
    meters = new Set();
    sessionMeters.set(sessionId, meters);
  }
  meters.add(meter);
  return () => {
    meters.delete(meter);
    if (meters.size === 0 && sessionMeters.get(sessionId) === meters) sessionMeters.delete(sessionId);
  };
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
  const resources = Promise.race([Promise.resolve().then(options.resources), unknownSize])
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
  // A session's sandbox that comes up between its turns is not billed until the next one starts.
  let paused = options.sessionId ? !runningTurns.has(options.sessionId) : false;
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
        headers: { "content-type": "application/json", ...platformHeaders(options.credential()) },
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
        options.onUnmetered?.();
        return true;
      }
      pending.shift();
    }
    return true;
  };

  const timer = setInterval(() => {
    void serial(async () => {
      if (stopped) return;
      if (!paused) cut();
      await flush();
    });
  }, options.intervalMs ?? SANDBOX_USAGE_INTERVAL_MS);
  timer.unref?.();

  const unwatch = options.sessionId
    ? watchSession(options.sessionId, {
        pause() {
          if (paused || stopped) return;
          // Cut at the turn's end now; the report follows in order, like any interval.
          cut();
          paused = true;
          void serial(async () => {
            await flush();
          });
        },
        resume() {
          if (!paused || stopped) return;
          paused = false;
          cursor = Math.max(cursor, Math.floor(now() / 1000));
        },
      })
    : () => {};

  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      unwatch();
      // Read now, not when the queue gets here: a report in flight must not stretch the last
      // interval past the stop, or into the next running period of the same sandbox.
      const stoppedAt = Math.floor(now() / 1000);
      const wasPaused = paused;
      const deadline = now() + FINAL_FLUSH_BUDGET_MS;
      const finalFlush = serial(async () => {
        if (!wasPaused) cut(stoppedAt);
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

/**
 * A meter that keeps its own credential fresh: a warm or parked-live sandbox outlives the run's
 * credential, so the lease lasts until the meter stops or the platform says it does not meter.
 */
export function startLeasedSandboxMeter(
  options: Omit<SandboxMeterOptions, "credential" | "onUnmetered"> & {
    authorization: string;
    startMeter?: typeof startSandboxMeter;
    startLease?: (authorization: string) => PlatformCredentialLease;
  },
): SandboxMeter {
  const { authorization, startMeter, startLease, ...meterOptions } = options;
  const lease = (startLease ?? ((value: string) => startPlatformCredentialLease(apiBase(), value)))(authorization);
  const meter = (startMeter ?? startSandboxMeter)({
    ...meterOptions,
    credential: lease.credential,
    onUnmetered: lease.release,
  });
  return {
    async stop(): Promise<void> {
      await meter.stop();
      lease.release();
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
