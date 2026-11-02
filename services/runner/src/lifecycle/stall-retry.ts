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
import type { AgentEvent, AgentRunResult, EmitEvent } from "../protocol.ts";
import { envInt } from "../env.ts";

export const TTFB_RETRIES_ENV = "AGENTA_RUNNER_RUN_TTFB_RETRIES";
export const DEFAULT_TTFB_RETRIES = 1;

/** Upper bound on the env override: each retry is a full cold rebuild, so this stays small. */
const MAX_TTFB_RETRIES = 3;

export interface StallRetryOptions {
  /**
   * The caller's live event sink. Each attempt gets its own gated copy (see `gateTerminalEvents`),
   * so a stalled attempt that is retried never shows the caller its `error` and `done` frames.
   */
  emit?: EmitEvent;
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

/** The frames that end a turn for the caller: the API closes the turn on `done`. */
function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === "error" || event.type === "done";
}

/** Environment setup progress (`agent-status`): a status line, never part of the conversation. */
function isTransientEvent(event: AgentEvent): boolean {
  return (event as { transient?: unknown }).transient === true;
}

/**
 * Wrap `emit` for one attempt so the terminal frames of an attempt that may still be retried wait
 * until the dispatch knows whether that attempt is final.
 *
 * A stalled attempt fails the normal way: the engine emits `error` and then `done` before it
 * returns. Sent live, that `done` closes the turn for the caller (for a detached channel run, the
 * failure is the answer the person reads) before the retry has even started. So the gate holds
 * `error` and `done` while the attempt could still turn out to be a stall:
 *
 * - `mayRetry()` is true (budget left, turn not stopped). Otherwise the frames go out at once.
 * - The attempt has sent only transient setup status so far. A stall sends nothing else: its
 *   TTFB timer is cancelled by the first event the turn records. So once any other frame has gone
 *   out, the attempt cannot be retried and its terminal frames go out live. This keeps a normal
 *   turn's `done` from waiting on the sandbox teardown that runs before the attempt returns.
 *
 * A frame that arrives after a held one proves the held one did not end the attempt, so the held
 * frames go out first, in order. `endedLive()` reports whether a terminal frame already reached the
 * caller: the dispatch never retries an attempt whose ending the caller has seen.
 */
function gateTerminalEvents(
  emit: EmitEvent,
  mayRetry: () => boolean,
): {
  emit: EmitEvent;
  release(): void;
  discard(): void;
  endedLive(): boolean;
} {
  let held: AgentEvent[] = [];
  let sentConversation = false;
  let sentTerminal = false;
  const send = (event: AgentEvent): void => {
    if (isTerminalEvent(event)) sentTerminal = true;
    emit(event);
  };
  const release = (): void => {
    const pending = held;
    held = [];
    for (const event of pending) send(event);
  };
  return {
    emit: (event) => {
      if (isTerminalEvent(event)) {
        if (sentConversation || !mayRetry()) {
          release();
          send(event);
        } else {
          held.push(event);
        }
        return;
      }
      if (!isTransientEvent(event)) sentConversation = true;
      release();
      send(event);
    },
    release,
    discard: () => {
      held = [];
    },
    endedLive: () => sentTerminal,
  };
}

/**
 * Run `attempt`, re-running it while it reports a pre-first-response stall and the budget holds.
 *
 * Each attempt receives its own gated copy of `options.emit` (undefined when the caller does not
 * stream). The terminal frames of an attempt that is retried are dropped; those of the final
 * attempt reach the caller, so the caller sees exactly one turn ending. The setup status frames
 * of a retried attempt are not dropped: they went out live, and the retry sends its own again.
 *
 * `stalledBeforeFirstResponse` is stripped from whatever is returned: it is this dispatch's own
 * signal, and a caller that could see it might retry a turn this function has already given up on.
 */
export async function runWithStallRetry(
  attempt: (emit: EmitEvent | undefined) => Promise<AgentRunResult>,
  options: StallRetryOptions = {},
): Promise<AgentRunResult> {
  const log = options.log ?? (() => {});
  const retries = options.retries ?? resolveStallRetries(log);

  for (let retried = 0; ; retried++) {
    const budgetLeft = retried < retries;
    const gate = options.emit
      ? gateTerminalEvents(
          options.emit,
          () => budgetLeft && !options.signal?.aborted,
        )
      : undefined;
    let result: AgentRunResult;
    try {
      result = await attempt(gate?.emit);
    } catch (err) {
      gate?.release();
      throw err;
    }
    const retry =
      result.stalledBeforeFirstResponse === true &&
      budgetLeft &&
      !options.signal?.aborted &&
      !gate?.endedLive();
    if (!retry) {
      gate?.release();
      if (result.stalledBeforeFirstResponse) {
        const { stalledBeforeFirstResponse: _stalled, ...settled } = result;
        return settled;
      }
      return result;
    }
    gate?.discard();
    log(
      `[run-limits] no first response and nothing emitted; re-prompting ` +
        `(attempt ${retried + 2}/${retries + 1}) ` +
        `session=${options.sessionId ?? "-"} turn=${options.turnId ?? "-"}`,
    );
  }
}
