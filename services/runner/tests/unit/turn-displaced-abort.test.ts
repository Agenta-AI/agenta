/**
 * #7760: the heartbeat's "this turn is no longer current" answer is a DISPLACEMENT, not a Stop.
 *
 * WHY THIS FILE EXISTS. One `AbortController` ends every run, and the reason object on the signal
 * is the only thing that tells the park policy WHY. Before this, the alive watchdog aborted with
 * `USER_STOP_ABORT_REASON` for a take-over and for a lost turn exactly as it did for a real Stop,
 * so the runner wrote down a user Stop nobody performed and the transcript hid the real cause.
 *
 * Every real Stop now arrives as a durable command on `POST /cancel`, which aborts the run
 * directly with the user-stop label (`sessions/control-channel.ts`, and
 * `control-command-apply.test.ts` for the delivery half). What is left on the heartbeat path is
 * displacement, and it gets its own label.
 *
 * The label is deliberately still a COOPERATIVE CANCEL (`isCooperativeCancelAbort`): the turn that
 * took the session over inherits its warm environment, and a kill destroys the pool entry by key
 * whether or not it was parked first. Only the recorded ending differs.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  isCooperativeCancelAbort,
  isRunnerShutdownAbort,
  isTurnDisplacedAbort,
  isUserStopAbort,
  RUNNER_SHUTDOWN_ABORT_REASON,
  TURN_DISPLACED_ABORT_REASON,
  USER_STOP_ABORT_REASON,
} from "../../src/sessions/stop-signal.ts";
import { shouldPark } from "../../src/engines/sandbox_agent/engine.ts";

function abortedWith(reason: unknown): AbortSignal {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
}

/** The result `runTurn` produces for a cancel whose harness answered, i.e. a parkable ending. */
const SETTLED_CANCEL = {
  ok: true,
  stopReason: "cancelled",
  cancelSettled: true,
} as const;

describe("the displaced-turn abort label", () => {
  it("is recognised as a displacement and NOT as a user Stop", () => {
    const signal = abortedWith(TURN_DISPLACED_ABORT_REASON);

    assert.equal(isTurnDisplacedAbort(signal), true);
    assert.equal(
      isUserStopAbort(signal),
      false,
      "the runner must not report a Stop the user never performed",
    );
  });

  it("cannot be forged from text, because the label is an object identity", () => {
    // The same mistake a string label would invite: a value that merely says "turn-displaced".
    assert.equal(
      isTurnDisplacedAbort(abortedWith({ agentaAbort: "turn-displaced" })),
      false,
    );
    assert.notEqual(TURN_DISPLACED_ABORT_REASON, USER_STOP_ABORT_REASON);
    assert.notEqual(TURN_DISPLACED_ABORT_REASON, RUNNER_SHUTDOWN_ABORT_REASON);
  });

  it("separates all three labelled aborts from an unlabelled one", () => {
    assert.equal(
      isTurnDisplacedAbort(abortedWith(USER_STOP_ABORT_REASON)),
      false,
    );
    assert.equal(
      isTurnDisplacedAbort(abortedWith(RUNNER_SHUTDOWN_ABORT_REASON)),
      false,
    );
    assert.equal(isTurnDisplacedAbort(abortedWith(undefined)), false);
    assert.equal(isTurnDisplacedAbort(undefined), false);
    assert.equal(isRunnerShutdownAbort(abortedWith(TURN_DISPLACED_ABORT_REASON)), false);
  });

  it("is a cooperative cancel, so a displaced turn may still park", () => {
    // The steer case: the next turn runs on the same pool key and wants the warm environment.
    const signal = abortedWith(TURN_DISPLACED_ABORT_REASON);

    assert.equal(isCooperativeCancelAbort(signal), true);
    assert.equal(shouldPark(SETTLED_CANCEL, signal, undefined), true);
  });

  it("still refuses to park when the harness never confirmed the cancel", () => {
    // The park needs both halves: a cooperative label AND a settled harness. A displacement whose
    // cancel did not settle leaves the sandbox in an unknown state, so it is destroyed.
    const signal = abortedWith(TURN_DISPLACED_ABORT_REASON);

    assert.equal(
      shouldPark({ ok: true, stopReason: "cancelled" }, signal, undefined),
      false,
    );
  });

  it("keeps the user-stop label a user stop", () => {
    // The other half of the split: a real Stop still parks and is still recorded as one.
    const signal = abortedWith(USER_STOP_ABORT_REASON);

    assert.equal(isUserStopAbort(signal), true);
    assert.equal(isTurnDisplacedAbort(signal), false);
    assert.equal(shouldPark(SETTLED_CANCEL, signal, undefined), true);
  });
});
