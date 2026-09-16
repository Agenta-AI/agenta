/**
 * Cancel the harness turn so the sandbox can be PARKED instead of deleted.
 *
 * WHAT THIS FIXES. A user Stop aborts the run signal. The turn then ends with
 * `stopReason: "cancelled"`, and `shouldPark` used to answer `false` for every aborted run, so
 * the sandbox was deleted and the next message paid a cold start. The abort alone never told the
 * harness anything: it only made the runner stop waiting. The harness kept its prompt open,
 * possibly with a tool still running, and the only thing that ever stopped it was the teardown
 * that was already deleting the sandbox.
 *
 * WHAT THIS DOES INSTEAD. Send the ACP `session/cancel` notification for the live session, then
 * wait a bounded time for the harness to answer the open `session/prompt`. ACP requires the agent
 * to end that prompt with `stopReason: "cancelled"` after a cancel, so a settled prompt promise is
 * the harness saying "I am idle again". Only a settled cancel may park. A cancel that cannot be
 * sent, or that the harness never answers in time, leaves the environment in an unknown state, and
 * unknown means delete.
 *
 * WHY THE CLIENT NEEDS A PATCH. `sandbox-agent`'s `SandboxAgent` refuses a manual `session/cancel`
 * ("Manual session/cancel calls are not allowed. Use destroySession(sessionId) instead."). The
 * guard is in the TypeScript client only; the daemon inside the sandbox proxies ACP and holds no
 * such rule. The existing pnpm patch adds `cancelSession(id)`, which sends the same managed cancel
 * `destroySession` sends but does NOT mark the session record destroyed. The `?.` below keeps this
 * module honest against an unpatched client: no method, no clean cancel, no park.
 *
 * WHY IT DOES NOT ABORT THE ENVIRONMENT'S MCP CONTROLLER. `env.mcpAbort` belongs to the
 * ENVIRONMENT, not the turn. Aborting it kills the tool-MCP server for every later turn, which is
 * exactly what a parked environment must keep. The approval-park path already skips it for the
 * same reason (see `run-turn.ts`, the `approvalParkMode` early return). The turn's own tool relay
 * is stopped separately, and a teardown that does happen still aborts the controller through
 * `teardownRuntimeInFlight`.
 */

import { envTimerMs } from "../../env.ts";

export const CANCEL_SETTLE_TIMEOUT_ENV =
  "AGENTA_RUNNER_HARNESS_CANCEL_SETTLE_MS";

/**
 * How long to wait for the harness to answer the cancelled prompt.
 *
 * Ten seconds is a starting value, not a measured one. It has to cover the adapter aborting the
 * tool it is running and writing its partial turn, and it has to stay well under the user's
 * patience for a second message. Raise it only with a measurement that shows a harness needing
 * more; every extra second is a second the Stop looks unfinished.
 */
export const DEFAULT_CANCEL_SETTLE_MS = 10_000;

export interface CancelHarnessTurnInput {
  /** The live sandbox client. `cancelSession` is absent on an unpatched `sandbox-agent`. */
  sandbox: { cancelSession?: (id: string) => Promise<unknown> } | undefined;
  /** The harness session id to cancel. */
  sessionId: string | undefined;
  /** The still-open `session/prompt` promise for this turn. */
  promptPromise: Promise<unknown> | undefined;
  timeoutMs?: number;
  log: (message: string) => void;
  /** Test seam. Defaults to a real timer. */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CancelHarnessTurnResult {
  /** True only when the cancel was sent AND the harness answered the prompt in time. */
  settled: boolean;
  /** True when the cancel notification left the runner, whatever the harness did next. */
  requested: boolean;
  /** Milliseconds from sending the cancel to the harness answering, when it answered. */
  elapsedMs: number;
}

export function resolveCancelSettleMs(): number {
  return envTimerMs(CANCEL_SETTLE_TIMEOUT_ENV, DEFAULT_CANCEL_SETTLE_MS, {
    min: 1,
  });
}

/**
 * Ask the harness to stop the current prompt and wait for it to say it did.
 *
 * Never throws. Every failure answers `settled: false`, which the caller reads as "destroy".
 */
export async function cancelHarnessTurn(
  input: CancelHarnessTurnInput,
): Promise<CancelHarnessTurnResult> {
  const unsettled = { settled: false, requested: false, elapsedMs: 0 };
  const cancelSession = input.sandbox?.cancelSession;
  if (!cancelSession || !input.sessionId || !input.promptPromise) {
    input.log(
      "stage=harness_cancel sent=false reason=" +
        (!cancelSession
          ? "client-has-no-cancelSession"
          : !input.sessionId
            ? "no-session"
            : "no-open-prompt"),
    );
    return unsettled;
  }

  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const timeoutMs = input.timeoutMs ?? resolveCancelSettleMs();
  const wait =
    input.wait ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const handle = setTimeout(resolve, ms);
        handle.unref?.();
      }));
  const TIMED_OUT = Symbol("cancel-settle-timeout");

  try {
    const requested = await Promise.race([
      cancelSession.call(input.sandbox, input.sessionId).then(() => true),
      wait(timeoutMs).then(() => TIMED_OUT),
    ]);
    if (requested === TIMED_OUT) {
      input.log(
        `stage=harness_cancel sent=false reason=request-timeout budget_ms=${timeoutMs}`,
      );
      return unsettled;
    }
  } catch (error) {
    input.log(
      "stage=harness_cancel sent=false error=" +
        (error instanceof Error ? error.message : String(error)).slice(0, 160),
    );
    return unsettled;
  }

  // A RESOLVED prompt is the harness reporting its own `stopReason`. A REJECTED one means the
  // prompt died on the transport instead, which says nothing about whether the harness stopped,
  // so it counts as unsettled and the environment is destroyed.
  const settledOk = await Promise.race([
    input.promptPromise.then(
      () => true,
      () => false,
    ),
    wait(timeoutMs).then(() => TIMED_OUT),
  ]);
  const elapsedMs = now() - startedAt;

  if (settledOk === true) {
    input.log(
      `stage=harness_cancel sent=true settled=true elapsed_ms=${elapsedMs}`,
    );
    return { settled: true, requested: true, elapsedMs };
  }
  input.log(
    `stage=harness_cancel sent=true settled=false elapsed_ms=${elapsedMs} ` +
      (settledOk === TIMED_OUT
        ? `reason=timeout budget_ms=${timeoutMs}`
        : "reason=prompt-rejected"),
  );
  return { settled: false, requested: true, elapsedMs };
}
