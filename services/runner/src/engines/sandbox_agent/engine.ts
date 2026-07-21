import {
  type AgentRunRequest,
  type AgentRunResult,
  type EmitEvent,
} from "../../protocol.ts";
import { acquireEnvironment } from "./environment.ts";
import { runTurn } from "./run-turn.ts";
import { type SandboxAgentDeps } from "./runtime-contracts.ts";

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
): Promise<AgentRunResult> {
  const acquired = await acquireEnvironment(request, deps, signal);
  if (!acquired.ok) return { ok: false, error: acquired.error };
  const env = acquired.env;
  let result: AgentRunResult | undefined;
  try {
    result = await runTurn(env, request, emit, signal, {
      loaded: env.loadedFromContinuity,
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
        ? "clean-resumable"
        : signal?.aborted
          ? "aborted"
          : "failed-turn",
    });
  }
}
