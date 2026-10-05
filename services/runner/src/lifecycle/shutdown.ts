/**
 * What a runner process does between SIGTERM and exit.
 *
 * With two or more pods, the other pods take new turns while this one leaves, so a deploy does
 * not have to cut the turns this pod runs. The sequence:
 *
 *  1. Drain. `/run` and `/stream` answer 503 from the first moment. Kubernetes takes the pod out
 *     of the Service endpoints on its own schedule, so the pod must refuse new work itself.
 *     `/cancel` and `/kill` stay open: the turns still run here, and a Stop must reach them.
 *  2. Wait. Every admitted execution may finish on its own, up to the configured wait. A turn
 *     parked on an approval runs nothing, so it does not hold the wait.
 *  3. Cancel. A turn still running is stopped the way a user Stop stops it: the harness is asked
 *     to cancel and the turn waits for its answer. A settled cancel ends the turn `cancelled`; an
 *     unsettled one deletes its sandbox. The settled wait matters even though step 4 deletes the
 *     sandbox anyway: it lets the harness finish writing its transcript to the durable mount, so
 *     the next pod loads a full history of that turn.
 *     An approval-parked prompt is released through its parked control directly, NOT through
 *     `applyCommand`. No Stop outcome reaches the api, so the pending approval stays answerable,
 *     and the user's answer later runs cold on another pod through the stored decision. Routing
 *     this through the Stop path would make the api cancel the approval.
 *  4. Tear down. Delete every sandbox the process holds, then exit.
 *
 * Every step is bounded, so the sequence fits inside the orchestrator's grace period.
 */
import { resolveCancelSettleMs } from "../engines/sandbox_agent/cancel-turn.ts";
import type { LiveExecution } from "../sessions/execution-registry.ts";
import type { ParkedSessionControl } from "../sessions/control-channel.ts";

let draining = false;

/** Refuse new turns from now on. Never undone: a process that starts draining is leaving. */
export function beginDrain(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}

/** Test seam. */
export function resetDrainForTest(): void {
  draining = false;
}

/**
 * Time a cancelled turn gets after its harness answers to write its ending and release its
 * environment (park or delete), on top of the harness cancel budget itself.
 */
const CANCEL_RELEASE_MARGIN_MS = 5_000;

/** The bound on one cancel step: the harness cancel budget plus the release margin. */
export function shutdownCancelBudgetMs(): number {
  return resolveCancelSettleMs() + CANCEL_RELEASE_MARGIN_MS;
}

/** How often the wait checks whether the admitted executions finished. */
const WAIT_POLL_MS = 250;

type Log = (message: string) => void;

function defaultLog(message: string): void {
  process.stderr.write(`${message}\n`);
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve when `work` settles or `budgetMs` passes, whichever is first. True when it settled. */
async function withinBudget(
  work: Promise<unknown>,
  budgetMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), budgetMs);
  });
  try {
    return await Promise.race([work.then(() => true), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export interface ShutdownSteps {
  /** How long admitted executions may run on before they are cancelled. */
  waitMs: number;
  /** True while any admitted execution still runs. */
  busy: () => boolean;
  /** Cancel every execution still running, and wait (bounded) for each to settle. */
  cancelRunning: () => Promise<void>;
  /** Cancel every approval-parked prompt, and wait (bounded) for each to settle. */
  cancelParked: () => Promise<void>;
  /** Delete every sandbox the process holds. */
  tearDown: () => Promise<void>;
  log?: Log;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Drain, wait, cancel, tear down. Never throws: a failed step must not skip the next one. */
export async function drainThenTearDown(steps: ShutdownSteps): Promise<void> {
  beginDrain();
  const log = steps.log ?? defaultLog;
  const sleep = steps.sleep ?? realSleep;
  const now = steps.now ?? (() => Date.now());
  const startedAt = now();
  const deadline = startedAt + steps.waitMs;
  log(`[shutdown] draining: new turns are refused; waiting up to ${steps.waitMs}ms for running turns`);
  while (steps.busy() && now() < deadline) {
    await sleep(Math.min(WAIT_POLL_MS, deadline - now()));
  }
  log(
    `[shutdown] wait ended after ${now() - startedAt}ms ` +
      (steps.busy() ? "with turns still running; cancelling them" : "with no turn running"),
  );
  const step = async (name: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      log(`[shutdown] ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await step("cancel running turns", steps.cancelRunning);
  await step("cancel parked prompts", steps.cancelParked);
  await step("teardown", steps.tearDown);
}

/**
 * Stop each execution the way a user Stop does, then wait (bounded) until each has released its
 * environment.
 *
 * The abort is the cancel: it makes the turn send the harness `session/cancel` and wait for the
 * answer, so a settled cancel ends `cancelled` and an unsettled one deletes the sandbox. An
 * execution whose prompt already settled is only tearing down; aborting it would make that
 * teardown delete a healthy environment, so it is only waited for.
 */
export async function cancelExecutions(
  executions: readonly LiveExecution[],
  budgetMs: number,
  log: Log = defaultLog,
): Promise<void> {
  if (executions.length === 0) return;
  for (const execution of executions) {
    if (!execution.settled) execution.abort();
  }
  const released = await withinBudget(
    Promise.allSettled(executions.map((execution) => execution.released ?? Promise.resolve(true))),
    budgetMs,
  );
  log(
    `[shutdown] cancelled ${executions.length} running turn(s); ` +
      (released ? "all released" : `not all released within ${budgetMs}ms`),
  );
}

/**
 * Release each approval-parked prompt in its harness and wait (bounded) for the harness to settle,
 * so the sandbox is deleted with nothing in flight. Each control is called directly: nothing is
 * reported to the api, and the approval stays pending there for the user to answer.
 */
export async function cancelParkedPrompts(
  parked: readonly ParkedSessionControl[],
  budgetMs: number,
  log: Log = defaultLog,
): Promise<void> {
  if (parked.length === 0) return;
  const stopped = await withinBudget(
    Promise.allSettled(parked.map((control) => Promise.resolve().then(() => control.stop()))),
    budgetMs,
  );
  log(
    `[shutdown] cancelled ${parked.length} parked prompt(s); ` +
      (stopped ? "all settled or torn down" : `not all done within ${budgetMs}ms`),
  );
}
