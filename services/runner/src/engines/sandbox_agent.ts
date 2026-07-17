/**
 * sandbox-agent harness driver.
 *
 * Drives a coding harness (Pi, Claude Code, ...) over the Agent Client Protocol (ACP)
 * through the `sandbox-agent` daemon, instead of the bespoke Pi SDK calls in the pi
 * engine. It serves the same /run contract (AgentRunRequest -> AgentRunResult), so the
 * Python side stays thin and the choice of harness/sandbox is config, not new code.
 *
 * Per invoke (cold), mirroring the shipped code-evaluator DaytonaRunner pattern:
 *
 *   SandboxAgent.start({ sandbox: local({ env }) | daytona({ create }) })
 *     -> createSession({ agent: <harness>, cwd, model })
 *       -> write AGENTS.md into cwd
 *       -> session.prompt([{ type: "text", text }])
 *         -> accumulate ACP `agent_message_chunk` text + build the trace
 *           -> destroySandbox()
 *
 * Two orthogonal axes swap independently: the sandbox (where the daemon runs) and the
 * harness (which engine). The ACP boundary is daemon-to-harness; the service-to-sandbox-agent
 * hop stays harness-agnostic behind the Harness port.
 *
 * Session keep-alive (flag-gated, off by default) splits the per-invoke work into
 * `acquireEnvironment` (session-scoped: sandbox, mount, session, MCP wiring) and `runTurn`
 * (per-turn: otel run, prompt, usage, trace). `runSandboxAgent` composes them exactly as
 * before (acquire -> runTurn -> destroy), so with the flag off behavior is byte-identical.
 * The dispatch in `server.ts` reuses the two halves to continue a live session across a turn
 * boundary. See docs/design/agent-workflows/projects/session-keepalive/plan.md.
 *
 * Tracing is built here from the ACP event stream (see tracing/otel.ts createSandboxAgentOtel),
 * so it is uniform across every harness and always nests under the caller's /invoke
 * span. stdout is reserved for the JSON result (see cli.ts); logs go to stderr.
 */

import {
  type AgentRunRequest,
  type AgentRunResult,
  type EmitEvent,
} from "../protocol.ts";
import { runTurn } from "./sandbox_agent/run-turn.ts";
import {
  type SandboxAgentDeps,
} from "./sandbox_agent/runtime-contracts.ts";

export {
  buildTurnText,
  messageTranscript,
} from "./sandbox_agent/transcript.ts";
export { toAcpMcpServers } from "./sandbox_agent/mcp.ts";
export { runTurn } from "./sandbox_agent/run-turn.ts";
export {
  sendLastMessageOnly,
  type SandboxAgentDeps,
  type ParkedApproval,
  type ResumeApprovalInput,
  type RunTurnOptions,
  type SessionEnvironment,
  type AcquireEnvironmentResult,
} from "./sandbox_agent/runtime-contracts.ts";
import {
  acquireEnvironment,
} from "./sandbox_agent/environment.ts";
export {
  acquireEnvironment,
  destroyInFlightSandboxes,
  destroyInFlightSandboxesForSession,
  resolveKeepaliveMount,
} from "./sandbox_agent/environment.ts";

function log(message: string): void {
  process.stderr.write(`[sandbox-agent] ${message}\n`);
}

type Log = (message: string) => void;

/**
 * The cold, one-turn-per-environment entry (also the flag-off path). Acquire an environment, run
 * one turn, then tear the environment down — exactly as the single `try/finally` did before the
 * split, so behavior here is byte-identical to pre-keep-alive.
 */

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
