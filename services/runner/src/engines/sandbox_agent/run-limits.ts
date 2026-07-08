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

function envMs(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultMs;
}

export const TOTAL_DEADLINE_ENV = "AGENTA_RUNNER_RUN_TOTAL_TIMEOUT_MS";
export const IDLE_TIMEOUT_ENV = "AGENTA_RUNNER_RUN_IDLE_TIMEOUT_MS";
export const TTFB_TIMEOUT_ENV = "AGENTA_RUNNER_RUN_TTFB_TIMEOUT_MS";
export const TOOL_CALL_TIMEOUT_ENV = "AGENTA_RUNNER_TOOL_CALL_TIMEOUT_MS";

export const DEFAULT_TOTAL_DEADLINE_MS = 45 * 60_000; // 45 min
export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000; // 5 min
export const DEFAULT_TTFB_TIMEOUT_MS = 2 * 60_000; // 2 min
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 5 * 60_000; // 5 min

export interface ResolvedRunLimits {
  totalMs: number;
  idleMs: number;
  ttfbMs: number;
  toolCallMs: number;
}

/**
 * Read every limit from its env var (wide default otherwise). `idle` must stay below `total` or
 * the idle timer could never be the one that fires — a misconfigured env clamps `idle` down
 * rather than throwing, since a bad override must not break every run in the process.
 */
export function resolveRunLimits(
  log: (message: string) => void = () => {},
): ResolvedRunLimits {
  const totalMs = envMs(TOTAL_DEADLINE_ENV, DEFAULT_TOTAL_DEADLINE_MS);
  let idleMs = envMs(IDLE_TIMEOUT_ENV, DEFAULT_IDLE_TIMEOUT_MS);
  const ttfbMs = envMs(TTFB_TIMEOUT_ENV, DEFAULT_TTFB_TIMEOUT_MS);
  const toolCallMs = envMs(TOOL_CALL_TIMEOUT_ENV, DEFAULT_TOOL_CALL_TIMEOUT_MS);
  if (idleMs >= totalMs) {
    log(
      `[run-limits] idle timeout (${idleMs}ms) >= total deadline (${totalMs}ms); clamping idle to half the total`,
    );
    idleMs = Math.floor(totalMs / 2);
  }
  return { totalMs, idleMs, ttfbMs, toolCallMs };
}

export interface RunLimitsHandle {
  /** Fires (once) the moment any limit trips; the caller wires this to its own `abort()`. */
  onTrip(handler: (reason: string) => void): void;
  /** Call on every tool call announcement; the per-tool-call timer keys off this id. */
  noteToolCallStart(id: string): void;
  /** Call once the tool call's result lands; clears its per-call timer. */
  noteToolCallEnd(id: string): void;
  /** Wrap an `EmitEvent` sink so every event it sees also resets idle/TTFB — the one
   *  observation point every harness's progress already flows through. */
  wrapEmit(emit: (event: any) => void): (event: any) => void;
  /** The turn parked for human input: freeze every timer for good (the pause path owns the
   *  turn's end from here; these deadlines must never re-fire on top of it). */
  notePaused(): void;
  /** Release every timer. Always call this once the run ends, on every path. */
  dispose(): void;
}

/**
 * Build the run-limit enforcement for one run. Arms the total deadline and the TTFB timer
 * immediately; the first progress event (via `wrapEmit`) cancels TTFB and arms the recurring idle
 * timer. Any of total/idle/ttfb/tool-call tripping calls the `onTrip` handler exactly once — after
 * that (or after `dispose`) the instance is inert, so a caller can always safely `dispose()` in its
 * own `finally` without double-firing or re-arming on a late event.
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
  let tripHandler: ((reason: string) => void) | undefined;
  let sawFirstProgress = false;

  let totalTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let ttfbTimer: NodeJS.Timeout | undefined;
  const toolCallTimers = new Map<string, NodeJS.Timeout>();

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

  const trip = (reason: string): void => {
    if (tripped || paused) return;
    tripped = true;
    clearAll();
    log(`[run-limits] ${reason}`);
    tripHandler?.(reason);
  };

  const armIdle = (): void => {
    if (tripped || paused) return;
    if (idleTimer) clock.clearTimeout(idleTimer);
    idleTimer = clock.setTimeout(
      () => trip(`idle timeout after ${limits.idleMs}ms with no progress`),
      limits.idleMs,
    );
  };

  totalTimer = clock.setTimeout(
    () => trip(`total run deadline of ${limits.totalMs}ms exceeded`),
    limits.totalMs,
  );
  ttfbTimer = clock.setTimeout(
    () => trip(`no first response within ${limits.ttfbMs}ms of run start`),
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
          trip(`tool call ${id} exceeded ${limits.toolCallMs}ms`);
        }, limits.toolCallMs),
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
    wrapEmit(emit) {
      // Every event is progress for idle/TTFB purposes; per-tool-call timers are driven
      // separately by noteToolCallStart/End (called from the raw ACP update handler, which
      // knows the harness's tool-call id before this typed event is even built).
      return (event: any) => {
        noteProgress();
        emit(event);
      };
    },
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
