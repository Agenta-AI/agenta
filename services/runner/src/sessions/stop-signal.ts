/**
 * Labelling the abort so the park policy can tell one kind of cancel from another.
 *
 * WHY A LABEL AND NOT THE FLAG. The runner has one `AbortController` per run, and several
 * different events end a run through it. Cooperative cancels are a subset: a user Stop, a runner
 * shutdown, and the platform reporting the turn is no longer current. The rest — a client
 * disconnect on a non-session run, anything a future call site adds — are not cancels, and their
 * environments must still be destroyed.
 *
 * Before this label, `shouldPark` could only read `signal.aborted`, which cannot answer WHY.
 * Inferring the cancel from `stopReason === "cancelled"` would be worse than it looks: the turn
 * sets that value whenever the signal aborts, whatever aborted it, so any new
 * `controller.abort()` anywhere in the runner would silently start parking sandboxes whose
 * state nobody has checked. The teardown allowlist exists precisely to stop that from being
 * possible, and these labels are what keep the allowlist honest.
 *
 * The mechanism is the standard one: `AbortController.abort(reason)` puts the value on
 * `signal.reason`, and the same signal object reaches the park decision, so nothing new has to
 * be threaded through the engine, the coordinator or the turn.
 *
 * WHY A USER STOP AND A DISPLACED TURN ARE LABELLED APART. Every real user Stop now travels the
 * durable command plane: the platform sends `POST /cancel`, routed to the turn's own binding, and
 * the applier aborts the run directly (`sessions/control-channel.ts`, wired in `server.ts`). The
 * heartbeat's `is_current_turn: false` is what is left over, and it means the platform took the
 * turn away — a steer opened a new turn on the session, a kill or the API's own watchdog ended
 * it. Calling that a user Stop made the runner write down a Stop nobody performed, which is
 * exactly what hid the cause of a lost turn. So the sweep now has its own label.
 *
 * WHAT IS STILL SHARED. A displaced turn is a cooperative cancel for the PARK decision: a steer
 * starts its next turn on the same pool key and wants the warm environment it inherits, and a
 * kill destroys the pool entry by key whether or not it was parked first. Only the recorded
 * ending differs (`server.ts` no longer rewrites a displacement into the `cancelled` envelope).
 * The heartbeat answer is one boolean, so takeover and a lost turn cannot be told apart here;
 * separating those two needs the platform to say which happened.
 */

/**
 * The `signal.reason` value a cooperative user Stop aborts with.
 *
 * A plain frozen object, not a string or an `Error`: object identity cannot be produced by
 * accident, so nothing can be mistaken for a Stop by writing the same text.
 */
export const USER_STOP_ABORT_REASON = Object.freeze({
  agentaAbort: "user-stop",
} as const);

/** True when this signal was aborted BY a cooperative user Stop, not by anything else. */
export function isUserStopAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && signal.reason === USER_STOP_ABORT_REASON;
}

/**
 * The `signal.reason` value a runner shutdown cancels a running turn with.
 *
 * The turn is cancelled the way a Stop cancels it, so its harness settles and its transcript
 * reaches durable storage. Nobody stopped it, though, so it ends with the restart error, which
 * the client offers to retry, not as a Stop.
 */
export const RUNNER_SHUTDOWN_ABORT_REASON = Object.freeze({
  agentaAbort: "runner-shutdown",
} as const);

/** True when this signal was aborted by a runner shutdown. */
export function isRunnerShutdownAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && signal.reason === RUNNER_SHUTDOWN_ABORT_REASON;
}

/**
 * The `signal.reason` value an abort carries when the platform reports this turn is no longer
 * current and no user Stop asked for it: another turn took the session over, or the platform
 * declared this turn lost.
 *
 * Set by the alive watchdog's `onInterrupted` callback in `server.ts`, which is the only place
 * that observes the heartbeat's `is_current_turn: false`. It is NOT `USER_STOP_ABORT_REASON`:
 * the runner cannot report a Stop the user never performed, and the turn's ending must not be
 * rewritten into the `cancelled` envelope a real Stop earns.
 */
export const TURN_DISPLACED_ABORT_REASON = Object.freeze({
  agentaAbort: "turn-displaced",
} as const);

/** True when this signal was aborted because the platform reported the turn is no longer current. */
export function isTurnDisplacedAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && signal.reason === TURN_DISPLACED_ABORT_REASON;
}

/**
 * True for the three aborts that cancel the harness and may park: a user Stop, a shutdown, and a
 * turn the platform displaced.
 *
 * A displacement belongs here for the reason above: the environment is idle and worth keeping
 * warm for the turn that takes the session over. It is labelled apart only so the recorded
 * ending can say what actually happened.
 */
export function isCooperativeCancelAbort(signal: AbortSignal | undefined): boolean {
  return (
    isUserStopAbort(signal) ||
    isRunnerShutdownAbort(signal) ||
    isTurnDisplacedAbort(signal)
  );
}
