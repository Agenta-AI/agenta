/**
 * Labelling the abort so the park policy can tell a user Stop from every other abort.
 *
 * WHY A LABEL AND NOT THE FLAG. The runner has one `AbortController` per run, and several
 * different events end a run through it. Only one of them is a cooperative user Stop: the
 * heartbeat reporting `is_current_turn: false` after the API cleared this turn's alive lock
 * (`sessions/alive.ts`, wired at `server.ts`). The rest — a client disconnect on a
 * non-session run, anything a future call site adds — are not Stops, and their environments
 * must still be destroyed.
 *
 * Before this label, `shouldPark` could only read `signal.aborted`, which cannot answer WHY.
 * Inferring the Stop from `stopReason === "cancelled"` would be worse than it looks: the turn
 * sets that value whenever the signal aborts, whatever aborted it, so any new
 * `controller.abort()` anywhere in the runner would silently start parking sandboxes whose
 * state nobody has checked. The teardown allowlist exists precisely to stop that from being
 * possible, and this label is what keeps the allowlist honest.
 *
 * The mechanism is the standard one: `AbortController.abort(reason)` puts the value on
 * `signal.reason`, and the same signal object reaches the park decision, so nothing new has to
 * be threaded through the engine, the coordinator or the turn.
 *
 * WHAT THIS LABEL DOES NOT DISTINGUISH. Cancel, steer and hard kill all reach the runner the
 * same way today: the API clears the alive lock and the next heartbeat reports it. So all three
 * arrive labelled as a user Stop. That is safe rather than merely tolerable. A steer WANTS the
 * warm environment for the turn it starts, and a kill separately calls the runner's `/kill`,
 * which destroys the pool entry by key whether or not it was parked first. Naming the actual
 * operation needs the durable command plane, which is work package B.
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
