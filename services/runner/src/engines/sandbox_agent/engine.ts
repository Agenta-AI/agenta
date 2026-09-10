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
 * Every other abort leaves the environment in an unknown state and still destroys.
 *
 * A SETTLED USER STOP IS CHECKED BEFORE `clientGone`, AND THAT ORDER IS THE WHOLE POINT.
 * `clientGone` used to be read first, which read well and broke the product on every real Stop.
 * The browser's Stop button aborts its own chat stream in the SAME tick it sends the durable
 * cancel command (`web/oss/src/components/AgentChatSlice/hooks/useAgentChatSession.ts`,
 * `handleStop`), so the disconnect and the labelled abort always arrive together. With the
 * disconnect read first, every Stop fell into the destroy branch: the sandbox was deleted, the
 * native harness session went with it, and the next message replayed cold. Observed on the
 * increment-6 stack on 2026-09-04, three Stops, three evictions, no warm park.
 *
 * The disconnect rule loses nothing it was written for. It exists so an UNATTENDED session is
 * never kept warm on a guess, and a Stop is not a guess: it is an authenticated command the API
 * recorded durably, from a user who is still on the page and about to type. Every other
 * disconnect — mid-turn tab close, a dropped connection, a failed turn — still destroys, and the
 * parked entry still expires on its own TTL.
 */
export function shouldPark(
  result: AgentRunResult,
  signal: AbortSignal | undefined,
  clientGone: (() => boolean) | undefined,
): boolean {
  // The harness is idle and the sandbox is worth keeping warm, whatever the stream did.
  const settledUserStop =
    isUserStopAbort(signal) &&
    result.ok === true &&
    result.stopReason === "cancelled" &&
    result.cancelSettled === true;
  if (settledUserStop) return true;
  if (clientGone?.()) return false; // client disconnected mid-turn: destroy, do not park
  if (signal?.aborted) return false; // any other abort: unknown state, destroy
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
