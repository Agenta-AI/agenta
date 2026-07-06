/**
 * Pure, hand-rolled queueing model for F4 (no simulation library, per
 * PLAN.md). Collapses loadmodel.json's 13 fine-grained stages into the five
 * the article narrates: service -> runner (queue-bound) -> sandbox create ->
 * turn -> teardown. Every duration below is either a literal midpoint of an
 * illustrativeLatencyMs range in loadmodel.json, or (for tool-relay-polling)
 * the model's own empirical constants. Nothing here is measured; see
 * loadModel.disclaimer, surfaced verbatim in LoadSim.tsx.
 */
import { loadModel } from "../../model";
import type { LoadModelStage } from "../../model/types";

export type StageId = "service" | "runnerQueue" | "sandboxCreate" | "turn" | "teardown";

export const STAGE_ORDER: StageId[] = ["service", "runnerQueue", "sandboxCreate", "turn", "teardown"];

export const STAGE_LABELS: Record<StageId, string> = {
  service: "Gateway + agent service",
  runnerQueue: "Runner (single process)",
  sandboxCreate: "Sandbox create",
  turn: "Harness turn",
  teardown: "Teardown",
};

function stage(id: string): LoadModelStage {
  const found = loadModel.stages.find((s) => s.id === id);
  if (!found) throw new Error(`pipeline.ts: loadmodel.json has no stage "${id}"`);
  return found;
}

function midpoint(s: LoadModelStage): number {
  const max = s.illustrativeLatencyMs.max ?? s.illustrativeLatencyMs.min;
  return (s.illustrativeLatencyMs.min + max) / 2;
}

const STAGE_BROWSER_TO_GATEWAY = stage("browser-to-gateway");
const STAGE_PARSE = stage("gateway-to-agent-service-parse");
const STAGE_SECRETS = stage("tool-secret-resolution");
const STAGE_TRANSPORT = stage("agent-service-to-runner-transport");
const STAGE_RUNNER_HTTP = stage("runner-http-server");
export const STAGE_COLD_LOCAL = stage("cold-sandbox-start-local");
export const STAGE_COLD_DAYTONA = stage("cold-sandbox-start-daytona");
export const STAGE_TURN_EXECUTION = stage("acp-turn-execution");
const STAGE_RELAY_POLLING = stage("tool-relay-polling");
const STAGE_TEARDOWN = stage("teardown");
const STAGE_USAGE_ROLLUP = stage("usage-and-trace-rollup");
const STAGE_RESPONSE = stage("runner-to-browser-response");

/** Fixed "model ms" duration for the front-of-pipeline stages folded into "service". */
export const SERVICE_STAGE_MS = midpoint(STAGE_BROWSER_TO_GATEWAY) + midpoint(STAGE_PARSE) + midpoint(STAGE_SECRETS) + midpoint(STAGE_TRANSPORT);

/** The runner's own dispatch cost, before any cold-start work begins; this is where the concurrency slot binds. */
export const RUNNER_QUEUE_STAGE_MS = midpoint(STAGE_RUNNER_HTTP);

/** Tail: teardown + usage/trace rollup + the final response frame. Always runs, per the teardown-on-finally structural fact. */
export const TEARDOWN_STAGE_MS = midpoint(STAGE_TEARDOWN) + midpoint(STAGE_USAGE_ROLLUP) + midpoint(STAGE_RESPONSE);

export const COLD_START_RANGE = {
  local: STAGE_COLD_LOCAL.illustrativeLatencyMs,
  daytona: STAGE_COLD_DAYTONA.illustrativeLatencyMs,
} as const;

export const TURN_DURATION_RANGE = STAGE_TURN_EXECUTION.illustrativeLatencyMs as { min: number; max: number };

/** The only real, code-verified numbers in the whole model (empirical: true). */
export const RELAY_POLL_CONSTANTS = STAGE_RELAY_POLLING.citations?.[0]?.constants ?? {};

export type ColdStartPreset = "local" | "daytona";

/**
 * "unlimited" models today's actual runner (structural fact
 * no-runner-concurrency-limit in loadmodel.json): every /run starts
 * immediately, nothing ever queues. "bounded" is the what-if slider this
 * simulator always had -- a hypothetical fixed-size concurrency pool, kept
 * as an illustrative comparison, not a claim about current behavior.
 */
export type ConcurrencyMode = "unlimited" | "bounded";

export interface SimConfig {
  arrivalPerMin: number;
  runnerConcurrency: number;
  concurrencyMode: ConcurrencyMode;
  coldStartPreset: ColdStartPreset;
  coldStartMs: number;
  turnDurationMs: number;
}

/**
 * In "unlimited" mode on a local sandbox, every concurrent run shares one
 * container's CPU/RAM, so overload shows up as contention (stages taking
 * longer) rather than queueing. Daytona sandboxes each get their own VM, so
 * no mutual slowdown is modeled there. This multiplier is explicitly
 * illustrative (labeled as such in the UI), not a measured curve.
 */
const CONTENTION_PER_EXTRA_RUN = 0.06;
const CONTENTION_MULTIPLIER_CAP = 4;

export function contentionMultiplier(inFlightCount: number): number {
  const extra = Math.max(0, inFlightCount - 1);
  return Math.min(1 + extra * CONTENTION_PER_EXTRA_RUN, CONTENTION_MULTIPLIER_CAP);
}

export interface Dot {
  id: number;
  stage: StageId;
  /** ms elapsed within the current stage (model-ms, not wall-clock ms). */
  progressMs: number;
  /** True while waiting for a free runner-concurrency slot; stage stays "runnerQueue" but progress is frozen. */
  queued: boolean;
  spawnedAtMs: number;
  lane: number;
  /** Set true the instant teardown completes; such dots are dropped, never rendered. */
  done?: boolean;
}

export interface SimState {
  dots: Dot[];
  nextId: number;
  activeSlots: number;
  /** Model-ms clock, monotonically increasing; only used for spawnedAtMs bookkeeping. */
  clockMs: number;
  arrivalAccumulatorMs: number;
  nextArrivalInMs: number;
  /** Completed turnaround latencies (model-ms), most recent last, capped to a rolling window. */
  completedLatencies: number[];
}

/** Sentinel meaning "no arrival scheduled yet"; stepSim samples a real one on first use. */
const UNSCHEDULED = -1;

export function createSimState(): SimState {
  return {
    dots: [],
    nextId: 0,
    activeSlots: 0,
    clockMs: 0,
    arrivalAccumulatorMs: 0,
    nextArrivalInMs: UNSCHEDULED,
    completedLatencies: [],
  };
}

/**
 * `inFlightCount` (total concurrent dots this frame) only affects the result
 * when config is "unlimited" + "local": that's the one combination where
 * this simulator claims contention, not queueing, absorbs overload. Callers
 * that don't pass it (or that are in bounded/daytona configs) get the plain
 * illustrative duration, unchanged.
 */
export function stageDurationMs(stageId: StageId, config: SimConfig, inFlightCount = 0): number {
  const base = (() => {
    switch (stageId) {
      case "service":
        return SERVICE_STAGE_MS;
      case "runnerQueue":
        return RUNNER_QUEUE_STAGE_MS;
      case "sandboxCreate":
        return config.coldStartMs;
      case "turn":
        return config.turnDurationMs;
      case "teardown":
        return TEARDOWN_STAGE_MS;
    }
  })();

  const contentionEligible =
    config.concurrencyMode === "unlimited" &&
    config.coldStartPreset === "local" &&
    (stageId === "turn" || stageId === "sandboxCreate");

  return contentionEligible ? base * contentionMultiplier(inFlightCount) : base;
}

const MAX_ROLLING_LATENCIES = 200;
/** Hard safety cap matching PLAN.md's "60fps with 200 dots" target; the UI's arrival-rate slider tops out near this. */
const MAX_DOTS = 220;

/** Exponential interarrival time (a proper Poisson process), in model-ms. */
function sampleInterarrivalMs(arrivalPerMin: number): number {
  const meanMs = 60000 / Math.max(arrivalPerMin, 0.001);
  const u = Math.max(Math.random(), 1e-9);
  return -Math.log(u) * meanMs;
}

/**
 * Advances the simulation by `dtMs` of model-time. Arrivals are sampled as a
 * Poisson process; dots march through the five stages; a dot cannot leave
 * "service" for "runnerQueue" until it acquires one of `runnerConcurrency`
 * slots, which is where queueing becomes visible. A slot is held from
 * "runnerQueue" acquisition through teardown completion (the whole
 * concurrent /run occupies the runner's process-tree resource, per the
 * runner-single-http-server structural fact).
 */
export function stepSim(state: SimState, dtMs: number, config: SimConfig): SimState {
  if (dtMs <= 0) return state;

  const clockMs = state.clockMs + dtMs;
  let arrivalAccumulatorMs = state.arrivalAccumulatorMs + dtMs;
  let nextArrivalInMs =
    state.nextArrivalInMs === UNSCHEDULED ? sampleInterarrivalMs(config.arrivalPerMin) : state.nextArrivalInMs;
  let nextId = state.nextId;
  const dots = state.dots.map((d) => ({ ...d }));

  // Spawn arrivals (bounded loop: at extreme rates this still terminates because
  // nextArrivalInMs is always > 0, and we cap total dots for render sanity).
  let guard = 0;
  while (arrivalAccumulatorMs >= nextArrivalInMs && dots.length < MAX_DOTS && guard < 1000) {
    arrivalAccumulatorMs -= nextArrivalInMs;
    nextArrivalInMs = sampleInterarrivalMs(config.arrivalPerMin);
    dots.push({
      id: nextId++,
      stage: "service",
      progressMs: 0,
      queued: false,
      spawnedAtMs: clockMs,
      lane: nextId % 11,
    });
    guard += 1;
  }

  let activeSlots = state.activeSlots;
  const completedLatencies = state.completedLatencies.slice();
  const survivors: Dot[] = [];
  const bounded = config.concurrencyMode === "bounded";
  // Snapshot once per frame (not recomputed per dot/per stage transition):
  // the contention story is "roughly this many concurrent runs", not a
  // precise per-tick count.
  const inFlightCount = dots.length;

  // Order matters for fair slot handoff: process in spawn order (already the array order).
  for (const dot of dots) {
    if (dot.queued) {
      if (!bounded || activeSlots < config.runnerConcurrency) {
        dot.queued = false;
        if (bounded) activeSlots += 1;
      } else {
        survivors.push(dot);
        continue;
      }
    }

    let remaining = dtMs;
    let advancing = true;
    while (advancing && remaining > 0) {
      const duration = stageDurationMs(dot.stage, config, inFlightCount);
      const left = duration - dot.progressMs;
      if (remaining < left) {
        dot.progressMs += remaining;
        remaining = 0;
        advancing = false;
        break;
      }
      remaining -= left;
      const nextIndex = STAGE_ORDER.indexOf(dot.stage) + 1;
      if (nextIndex >= STAGE_ORDER.length) {
        // Finished teardown: release the slot (bounded mode only), record
        // the completion, drop the dot.
        if (bounded) activeSlots = Math.max(0, activeSlots - 1);
        completedLatencies.push(clockMs - remaining - dot.spawnedAtMs);
        advancing = false;
        dot.stage = "teardown";
        dot.progressMs = duration;
        dot.done = true;
        break;
      }
      dot.stage = STAGE_ORDER[nextIndex];
      dot.progressMs = 0;
      if (dot.stage === "runnerQueue") {
        // Entering the runner for the first time. In "bounded" (what-if)
        // mode, acquire a concurrency slot now or start waiting for one --
        // this is the one place queueing becomes visible. In "unlimited"
        // mode (today's actual runner) there is no slot to wait for: every
        // run starts immediately, so this dot just keeps advancing.
        if (bounded) {
          if (activeSlots < config.runnerConcurrency) {
            activeSlots += 1;
          } else {
            dot.queued = true;
            advancing = false;
          }
        }
      }
    }

    if (!dot.done) {
      survivors.push(dot);
    }
  }

  while (completedLatencies.length > MAX_ROLLING_LATENCIES) completedLatencies.shift();

  return {
    dots: survivors,
    nextId,
    activeSlots,
    clockMs,
    arrivalAccumulatorMs,
    nextArrivalInMs,
    completedLatencies,
  };
}

export function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

export function computeLatencyStats(latencies: number[]): { p50?: number; p95?: number } {
  if (latencies.length === 0) return {};
  const sorted = latencies.slice().sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}
