import {
  type AgentRunRequest,
  type AgentRunResult,
  type EmitEvent,
} from "../../protocol.ts";
import { isUserStopAbort } from "../../sessions/stop-signal.ts";
import { acquireEnvironment } from "./environment.ts";
import { runCredential } from "./runtime-policy.ts";
import { loadDurableDecisions } from "../../sessions/interactions.ts";
import { runTurn } from "./run-turn.ts";
import {
  type RunTurnOptions,
  type SandboxAgentDeps,
} from "./runtime-contracts.ts";

/**
 * Whether a completed turn's environment may be parked: never on client disconnect, pause, or
 * failure. Session-owned streams survive disconnect WITHOUT aborting the run signal (server
 * policy), so the disconnect check needs the separate `clientGone` flag. A wedged sandbox that
 * failed its turn must be destroyed, not reconnected on the next one.
 *
 * A USER STOP IS THE ONE ABORT THAT MAY PARK. Stop and Delete are different operations: Stop
 * keeps the session, the sandbox, and the harness session resumable. Three things must all be
 * true, and each answers a different question:
 *
 *  - `isUserStopAbort(signal)` — WAS this abort a cooperative Stop? The signal is labelled at
 *    the one call site that means it (`server.ts`, the heartbeat interrupt). Reading
 *    `signal.aborted` alone cannot answer this, and inferring it from the stop reason would let
 *    any future `controller.abort()` park a sandbox nobody checked. See `sessions/stop-signal.ts`.
 *  - `result.stopReason === "cancelled"` — did the TURN actually end as a cancel?
 *  - `result.cancelSettled` — did the HARNESS confirm it stopped? See `cancel-turn.ts`.
 *
 * Every other abort leaves the environment in an unknown state and still destroys. The
 * `clientGone` check moved ABOVE the abort check so a disconnect keeps destroying exactly as it
 * did before, whatever the abort says.
 */
export function shouldPark(
  result: AgentRunResult,
  signal: AbortSignal | undefined,
  clientGone: (() => boolean) | undefined,
): boolean {
  if (clientGone?.()) return false; // client disconnected mid-turn: destroy, do not park
  if (signal?.aborted) {
    // A settled user Stop: the harness is idle and the sandbox is worth keeping warm.
    return (
      isUserStopAbort(signal) &&
      result.ok === true &&
      result.stopReason === "cancelled" &&
      result.cancelSettled === true
    );
  }
  if (!result.ok) return false; // failed turn: teardown as today
  if (result.stopReason === "paused") return false; // a plain pause never parks
  return true;
}

/**
 * The cold, one-turn-per-environment entry (also the flag-off path). Acquire an environment, run
 * one turn, then tear the environment down — exactly as the single `try/finally` did before the
 * split, so behavior here is byte-identical to pre-keep-alive.
 */
export async function runSandboxAgent(
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
  deps: SandboxAgentDeps = {},
  turnOptions: Pick<RunTurnOptions, "credential" | "seededDecisions"> = {},
): Promise<AgentRunResult> {
  const acquired = await acquireEnvironment(
    request,
    deps,
    signal,
    undefined,
    emit,
  );
  if (!acquired.ok) return { ok: false, error: acquired.error };
  const env = acquired.env;
  let result: AgentRunResult | undefined;
  try {
    result = await runTurn(env, request, emit, signal, {
      loaded: env.loadedFromContinuity,
      nativeHistoryVerified: env.nativeHistoryVerified,
      ...turnOptions,
      // After the spread so a caller-supplied set wins, and short-circuited so we never CLAIM
      // rows the spread would then discard — a claimed row is spent even if it is thrown away.
      // Read + claim BEFORE the turn: runTurn must not suspend before its responder is wired.
      seededDecisions:
        turnOptions.seededDecisions ??
        (await loadDurableDecisions(
          env.sessionId,
          runCredential(request),
          env.logger,
        )),
    });
    return result;
  } finally {
    // `result` is undefined when runTurn threw: a failed turn, so destroy.
    const cleanResumable =
      env.resumable &&
      result !== undefined &&
      shouldPark(result, signal, undefined);
    await env.destroy({
      reason: cleanResumable
        ? // A settled Stop parks under its own reason, so the log says WHY the sandbox survived.
          result?.stopReason === "cancelled"
          ? "cancelled"
          : "clean-resumable"
        : signal?.aborted
          ? "aborted"
          : "failed-turn",
    });
  }
}
