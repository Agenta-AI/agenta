/**
 * Time-based run limits: the runner had no deadline anywhere, so a wedged run (daemon up but
 * never engaging, or a harness that stops making progress mid-turn) held its sandbox/mount/socket
 * forever while the platform still reported the session healthy. This computes and enforces the
 * time dimension only (no step/byte counting) and fires the caller's `abort()` when a limit trips,
 * so the EXISTING `runSandboxAgent` `finally` reclaims exactly as it does for any other abort.
 *
 * Every limit is env-overridable with a wide default (see the `_ENV` constants below) and the
 * whole thing goes inert once the run pauses for human input (`notePaused()`) — a HITL pause is a
 * legitimate, human-timescale wait, not a wedge, and must never be reaped by these deadlines.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { clampTimerMs, envTimerMs } from "../../env.ts";

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(handle: NodeJS.Timeout): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export const TOTAL_DEADLINE_ENV = "AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS";
export const IDLE_TIMEOUT_ENV = "AGENTA_RUNNER_RUN_IDLE_TIMEOUT_MS";
export const TTFB_TIMEOUT_ENV = "AGENTA_RUNNER_RUN_TTFB_TIMEOUT_MS";
export const TOOL_CALL_TIMEOUT_ENV = "AGENTA_RUNNER_TOOL_CALL_TIMEOUT_MS";
/** The `commandTimeoutSeconds` limit, handed to the Agenta Pi extension, which caps Pi's own shell tool with it. */
export const PI_COMMAND_TIMEOUT_ENV = "AGENTA_AGENT_COMMAND_TIMEOUT_SECONDS";

// 11 hours. This default must stay BELOW the mount-lease TTL (43200s, see
// AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS in the API's env.py) minus the 60s
// MOUNT_LEASE_SKEW_MS: the session coordinator only reuses a warm sandbox when its
// mount lease covers `now + this deadline + skew` (session-coordinator.ts's
// `requiredValidThroughMs` horizon), so a default at or above the lease TTL makes
// every mount-backed warm session rebuild cold. The ~1h gap under the 12h lease is
// the warm parking window.
export const DEFAULT_TOTAL_DEADLINE_MS = 11 * 60 * 60_000; // 11 hours
// 30 minutes; override with AGENTA_RUNNER_RUN_IDLE_TIMEOUT_MS.
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_TTFB_TIMEOUT_MS = 2 * 60_000; // 2 min
// 30 minutes; override with AGENTA_RUNNER_TOOL_CALL_TIMEOUT_MS.
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 30 * 60_000;
/**
 * How long past the tool-call limit the run-wide watchdog waits for the tool's result. The limit
 * itself is enforced on the command: every shell tool the runner can configure is told to stop
 * its command at `toolCallMs` (`commandTimeoutSeconds`), and the stopped command comes back to the
 * model as an ordinary tool error, so the turn continues. Only a tool call whose result has not
 * arrived even this long after the limit ends the turn: its kill did not work, or the tool is one
 * the runner cannot configure.
 */
// Covers the kill's confirmation (5 s) and the drive flush after a stopped in-process command (up
// to 65 s with its control allowance), with room to spare.
export const TOOL_CALL_GRACE_MS = 120_000;

/**
 * The timeout, in seconds, a shell command gets: what the model asked for, never more than the
 * per-tool-call limit. A command stopped at this timeout returns a tool error to the model, which
 * keeps the turn going; one that ran past it would trip the run-wide watchdog instead.
 */
export function commandTimeoutSeconds(
  requestedSeconds: number | undefined,
  toolCallMs: number = resolveRunLimits().toolCallMs,
): number {
  const limit = Math.max(1, Math.floor(toolCallMs / 1000));
  return requestedSeconds !== undefined && requestedSeconds > 0 ? Math.min(requestedSeconds, limit) : limit;
}

/**
 * The longest turn the caller's plan allows, as the platform's turn admission states it, with the
 * line the person reads when a turn is stopped at it. Absent on a deployment that does not meter
 * sandboxes, where the env deadline above is the only one.
 */
export interface TurnLimit {
  ms: number;
  message: string;
}

interface AdmittedTurnLimit {
  limit: TurnLimit;
  deadlineMs: number;
}

const turnLimitStorage = new AsyncLocalStorage<AdmittedTurnLimit | undefined>();

/**
 * Run `fn` with the plan's turn limit in scope for every turn it starts. The limit runs from
 * this call, so an attempt started later in the same admitted turn (a stall retry) gets only
 * the time left, not a fresh limit.
 */
export function runWithTurnLimit<T>(limit: TurnLimit | undefined, fn: () => T): T {
  return turnLimitStorage.run(limit && { limit, deadlineMs: Date.now() + limit.ms }, fn);
}

/** The plan's turn limit in scope, shortened to the time left since admission. */
function remainingTurnLimit(): TurnLimit | undefined {
  const admitted = turnLimitStorage.getStore();
  if (!admitted) return undefined;
  return {
    ms: Math.max(1, admitted.deadlineMs - Date.now()),
    message: admitted.limit.message,
  };
}

/** Every timer field is a usable timer delay (integer ms, at least 1, within Node's timer range) —
 *  `resolveRunLimits` guarantees it, so callers can arm any of them without re-checking. */
export interface ResolvedRunLimits {
  totalMs: number;
  idleMs: number;
  ttfbMs: number;
  toolCallMs: number;
  /** Added to `toolCallMs` before the watchdog ends the turn over one tool call (`TOOL_CALL_GRACE_MS`); 0 when absent. */
  toolCallGraceMs?: number;
  /** Set when the plan's turn limit, not the env deadline, is what `totalMs` enforces. */
  turnLimitMessage?: string;
}

/**
 * Read every limit from its env var (wide default otherwise). `idle` must stay below `total` or
 * the idle timer could never be the one that fires — a misconfigured env clamps `idle` down
 * rather than throwing, since a bad override must not break every run in the process.
 */
export function resolveRunLimits(
  log: (message: string) => void = () => {},
  turnLimit: TurnLimit | undefined = remainingTurnLimit(),
): ResolvedRunLimits {
  const envMs = (name: string, defaultMs: number): number =>
    envTimerMs(name, defaultMs, { log });
  const envTotalMs = envMs(TOTAL_DEADLINE_ENV, DEFAULT_TOTAL_DEADLINE_MS);
  // The plan can only shorten a turn: an operator's lower env deadline still wins.
  const planBinds = turnLimit !== undefined && turnLimit.ms > 0 && turnLimit.ms <= envTotalMs;
  const totalMs = planBinds ? turnLimit.ms : envTotalMs;
  let idleMs = envMs(IDLE_TIMEOUT_ENV, DEFAULT_IDLE_TIMEOUT_MS);
  const ttfbMs = envMs(TTFB_TIMEOUT_ENV, DEFAULT_TTFB_TIMEOUT_MS);
  const toolCallMs = envMs(TOOL_CALL_TIMEOUT_ENV, DEFAULT_TOOL_CALL_TIMEOUT_MS);
  // A plan's short turn limit is not a misconfigured idle timeout: the total deadline simply
  // fires first, so only an operator's own env pair is clamped.
  if (idleMs >= totalMs && !planBinds) {
    log(
      `[run-limits] idle timeout (${idleMs}ms) >= total deadline (${totalMs}ms); clamping idle to half the total`,
    );
    idleMs = Math.floor(totalMs / 2);
  }
  // Every field is armed directly as a timer delay, so the whole record leaves this function
  // inside the timer domain — including the values DERIVED above rather than read from env
  // (half of a total already sitting at its own floor rounds to 0, which fires instantly).
  // Normalizing the result, not each derivation, keeps that true of any future adjustment here.
  return {
    totalMs: clampTimerMs(totalMs),
    idleMs: clampTimerMs(idleMs),
    ttfbMs: clampTimerMs(ttfbMs),
    toolCallMs: clampTimerMs(toolCallMs),
    toolCallGraceMs: TOOL_CALL_GRACE_MS,
    ...(planBinds ? { turnLimitMessage: turnLimit.message } : {}),
  };
}

/**
 * Which limit ended the run. `ttfb` is the one the caller can act on: the TTFB timer is cancelled
 * by the first progress event of any kind, so a `ttfb` trip PROVES the turn emitted nothing at all
 * — no token, no tool call, no side effect — which is what makes re-prompting it safe. Every other
 * kind fires mid-turn, where work has already landed and a replay could repeat it.
 */
export type RunLimitKind = "total" | "idle" | "ttfb" | "tool-call";

export interface RunLimitsHandle {
  /** Fires (once) the moment any limit trips; the caller wires this to its own `abort()`. */
  onTrip(handler: (reason: string, kind: RunLimitKind) => void): void;
  /** Call on every tool call announcement; the per-tool-call timer keys off this id. */
  noteToolCallStart(id: string): void;
  /** Call once the tool call's result lands; clears its per-call timer. */
  noteToolCallEnd(id: string): void;
  /** Call on every sign of turn progress (the tracer's `onProgress`): cancels TTFB on the first
   *  call and resets idle on each one. Works the same whether or not the turn streams. */
  noteProgress(): void;
  /** The turn parked for human input: freeze every timer for good (the pause path owns the
   *  turn's end from here; these deadlines must never re-fire on top of it). */
  notePaused(): void;
  /** Release every timer. Always call this once the run ends, on every path. */
  dispose(): void;
}

/**
 * Build the run-limit enforcement for one run. Arms the total deadline and the TTFB timer
 * immediately; the first progress event (via `noteProgress`) cancels TTFB and arms the recurring
 * idle timer. Any of total/idle/ttfb/tool-call tripping calls the `onTrip` handler exactly once —
 * after that (or after `dispose`) the instance is inert, so a caller can always safely `dispose()`
 * in its own `finally` without double-firing or re-arming on a late event.
 */
export function createRunLimits(
  limits: ResolvedRunLimits,
  {
    clock = realClock,
    log = () => {},
  }: { clock?: Clock; log?: (message: string) => void } = {},
): RunLimitsHandle {
  let tripped = false;
  let paused = false;
  let tripHandler: ((reason: string, kind: RunLimitKind) => void) | undefined;
  let sawFirstProgress = false;

  let totalTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let ttfbTimer: NodeJS.Timeout | undefined;
  const toolCallTimers = new Map<string, NodeJS.Timeout>();
  const grace = limits.toolCallGraceMs ?? 0;

  const clearAll = (): void => {
    if (totalTimer) clock.clearTimeout(totalTimer);
    if (idleTimer) clock.clearTimeout(idleTimer);
    if (ttfbTimer) clock.clearTimeout(ttfbTimer);
    for (const timer of toolCallTimers.values()) clock.clearTimeout(timer);
    totalTimer = undefined;
    idleTimer = undefined;
    ttfbTimer = undefined;
    toolCallTimers.clear();
  };

  const trip = (reason: string, kind: RunLimitKind): void => {
    if (tripped || paused) return;
    tripped = true;
    clearAll();
    log(`[run-limits] ${reason}`);
    tripHandler?.(reason, kind);
  };

  const armIdle = (): void => {
    if (tripped || paused) return;
    if (idleTimer) clock.clearTimeout(idleTimer);
    idleTimer = clock.setTimeout(() => {
      // A tool call in flight is bounded by its own timer, which waits for the stopped command's
      // result; a silent command must not be cut by the idle limit first (both default to 30 min).
      if (toolCallTimers.size > 0) return armIdle();
      trip(`idle timeout after ${limits.idleMs}ms with no progress`, "idle");
    }, limits.idleMs);
  };

  totalTimer = clock.setTimeout(
    () => trip(`total run deadline of ${limits.totalMs}ms exceeded`, "total"),
    limits.totalMs,
  );
  ttfbTimer = clock.setTimeout(
    () =>
      trip(`no first response within ${limits.ttfbMs}ms of run start`, "ttfb"),
    limits.ttfbMs,
  );

  const noteProgress = (): void => {
    if (tripped || paused) return;
    if (!sawFirstProgress) {
      sawFirstProgress = true;
      if (ttfbTimer) clock.clearTimeout(ttfbTimer);
      ttfbTimer = undefined;
    }
    armIdle();
  };

  return {
    onTrip(handler) {
      tripHandler = handler;
    },
    noteToolCallStart(id) {
      if (tripped || paused || !id) return;
      noteProgress();
      const existing = toolCallTimers.get(id);
      if (existing) clock.clearTimeout(existing);
      toolCallTimers.set(
        id,
        clock.setTimeout(() => {
          toolCallTimers.delete(id);
          trip(
            `tool call ${id} exceeded ${limits.toolCallMs}ms and returned no result within ${grace}ms more`,
            "tool-call",
          );
        }, clampTimerMs(limits.toolCallMs + grace)),
      );
    },
    noteToolCallEnd(id) {
      const timer = toolCallTimers.get(id);
      if (timer) {
        clock.clearTimeout(timer);
        toolCallTimers.delete(id);
      }
      noteProgress();
    },
    // Every recorded event is progress for idle/TTFB purposes; per-tool-call timers are driven
    // separately by noteToolCallStart/End (called from the raw ACP update handler, which knows
    // the harness's tool-call id before this typed event is even built).
    noteProgress,
    notePaused() {
      paused = true;
      clearAll();
    },
    dispose() {
      // Mark inert so a late ACP event cannot re-arm a timer after teardown.
      tripped = true;
      clearAll();
    },
  };
}
