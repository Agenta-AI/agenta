import {
  type AgentRunRequest,
  type AgentRunResult,
  type EmitEvent,
} from "../../protocol.ts";
import { parseGatewayErrorDetail } from "../../gateway-error.ts";
import { acquireEnvironment } from "./environment.ts";
import { runCredential } from "./runtime-policy.ts";
import { loadDurableDecisions } from "../../sessions/interactions.ts";
import { runTurn } from "./run-turn.ts";
import {
  type RunTurnOptions,
  type SandboxAgentDeps,
} from "./runtime-contracts.ts";

/** Every `AgentRunResult` this engine returns passes through here: the one choke point where a
 * gateway refusal recoverable from the harness's error text (`gateway-error.ts`) gets attached,
 * regardless of which of `runTurn`'s several failure paths produced it. */
export function withGatewayErrorDetail(result: AgentRunResult): AgentRunResult {
  if (result.ok || result.errorDetail || !result.error) return result;
  const errorDetail = parseGatewayErrorDetail(result.error);
  return errorDetail ? { ...result, errorDetail } : result;
}

/**
 * Whether a completed turn's environment may be parked: never on abort, client disconnect,
 * pause, or failure. Session-owned streams survive disconnect WITHOUT aborting the run signal
 * (server policy), so the disconnect check needs the separate `clientGone` flag. A wedged
 * sandbox that failed its turn must be destroyed, not reconnected on the next one.
 */
export function shouldPark(
  result: AgentRunResult,
  signal: AbortSignal | undefined,
  clientGone: (() => boolean) | undefined,
): boolean {
  if (signal?.aborted) return false; // aborted run: destroy, do not park
  if (clientGone?.()) return false; // client disconnected mid-turn: destroy, do not park
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
  if (!acquired.ok)
    return withGatewayErrorDetail({ ok: false, error: acquired.error });
  const env = acquired.env;
  let result: AgentRunResult | undefined;
  try {
    result = await runTurn(env, request, emit, signal, {
      loaded: env.loadedFromContinuity,
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
    result = withGatewayErrorDetail(result);
    return result;
  } finally {
    // `result` is undefined when runTurn threw: a failed turn, so destroy.
    const cleanResumable =
      env.resumable &&
      result !== undefined &&
      shouldPark(result, signal, undefined);
    await env.destroy({
      reason: cleanResumable
        ? "clean-resumable"
        : signal?.aborted
          ? "aborted"
          : "failed-turn",
    });
  }
}
