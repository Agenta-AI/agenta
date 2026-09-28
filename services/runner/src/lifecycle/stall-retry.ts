/**
 * Re-prompt a turn that stalled before its FIRST response.
 *
 * The TTFB run-limit (`run-limits.ts`) exists to reap a wedged harness holding a sandbox forever,
 * and it does that correctly. What it cannot do is tell a wedged harness from a model call that is
 * merely slow to return its first chunk, because both are silence. So a transient upstream stall
 * ends the turn, and the user reads "the agent run failed and produced no answer" as their final
 * answer — losing the message outright. The platform cannot recover it either: a channel starts the
 * run DETACHED, so its inbox task had already settled minutes before the limit tripped.
 *
 * Re-prompting is safe in exactly this case and no other. The TTFB timer is cancelled by the first
 * progress event of any kind, so reaching it proves the turn emitted no token, ran no tool and left
 * no side effect — there is nothing a replay could repeat. The runner states that on the result as
 * `stalledBeforeFirstResponse`, and sets it only for a fresh prompt (never a resume or a
 * continuation, which carry earlier work). The failed attempt has already evicted its session, so
 * each retry rebuilds cold.
 *
 * One retry by default: a second stall is evidence of something durable rather than a hiccup, and
 * every attempt costs a full sandbox build.
 */
import type { AgentRunResult } from "../protocol.ts";
import { envInt } from "../env.ts";

export const TTFB_RETRIES_ENV = "AGENTA_RUNNER_RUN_TTFB_RETRIES";
export const DEFAULT_TTFB_RETRIES = 1;

/** Upper bound on the env override: each retry is a full cold rebuild, so this stays small. */
const MAX_TTFB_RETRIES = 3;

export interface StallRetryOptions {
  /** Aborted means the user stopped the turn (or the client left); never retry into that. */
  signal?: AbortSignal;
  log?: (message: string) => void;
  /** Overrides the env read, for tests. */
  retries?: number;
  /** Labels the log line so a retry is traceable to its turn. */
  sessionId?: string;
  turnId?: string;
}

export function resolveStallRetries(
  log: (message: string) => void = () => {},
): number {
  return envInt(TTFB_RETRIES_ENV, DEFAULT_TTFB_RETRIES, {
    min: 0,
    max: MAX_TTFB_RETRIES,
    log,
  });
}

/**
 * Run `attempt`, re-running it while it reports a pre-first-response stall and the budget holds.
 *
 * `stalledBeforeFirstResponse` is stripped from whatever is returned: it is this dispatch's own
 * signal, and a caller that could see it might retry a turn this function has already given up on.
 */
export async function runWithStallRetry(
  attempt: () => Promise<AgentRunResult>,
  options: StallRetryOptions = {},
): Promise<AgentRunResult> {
  const log = options.log ?? (() => {});
  const retries = options.retries ?? resolveStallRetries(log);

  let result = await attempt();
  for (
    let retried = 0;
    result.stalledBeforeFirstResponse &&
    retried < retries &&
    !options.signal?.aborted;
    retried++
  ) {
    log(
      `[run-limits] no first response and nothing emitted; re-prompting ` +
        `(attempt ${retried + 2}/${retries + 1}) ` +
        `session=${options.sessionId ?? "-"} turn=${options.turnId ?? "-"}`,
    );
    result = await attempt();
  }

  if (result.stalledBeforeFirstResponse) {
    const { stalledBeforeFirstResponse: _stalled, ...settled } = result;
    return settled;
  }
  return result;
}
