import { envFlag } from "../env.ts";

/**
 * Inter-arrival trace for streamed assistant text.
 *
 * Frame capture of a cloud session showed the transcript gaining ONE word every ~400ms. The
 * client now paces the reveal so that reads as continuous typing, but WHY the gap is 400ms is
 * still unmeasured: it could be the harness's emitter, a buffering hop between the sandbox and
 * the runner, or the model itself. This records the cadence at the seam every harness shares —
 * the ACP `session/update` handler — so the three can be told apart instead of guessed at.
 *
 * Off unless `AGENTA_RUNNER_STREAM_TRACE` is set: one stderr line per delta is far too much for
 * a normal run.
 */

/** Env flag that turns the trace on. */
export const STREAM_TRACE_ENV = "AGENTA_RUNNER_STREAM_TRACE";

export interface StreamTrace {
  /** One arriving delta. `kind` is `message` or `thought`; `chars` is the delta's length. */
  record(kind: string, chars: number): void;
  /** A text or reasoning block ended, so the next delta of that kind starts a new cadence. */
  closeBlock(kind: string): void;
}

export interface StreamTraceOptions {
  harness?: string;
  write?: (line: string) => void;
  now?: () => number;
}

/** Null when the flag is unset, so the call site is a single `?.record(...)`. */
export function createStreamTrace({
  harness,
  write = (line) => process.stderr.write(line),
  now = () => performance.now(),
}: StreamTraceOptions = {}): StreamTrace | null {
  if (!envFlag(STREAM_TRACE_ENV)) return null;
  const previous = new Map<string, number>();
  return {
    record(kind, chars) {
      const at = now();
      const last = previous.get(kind);
      previous.set(kind, at);
      // The first delta of a block has no predecessor, so its gap is time-to-first-token,
      // which belongs to a different question. Report it as `-` rather than as a cadence.
      const gap = last === undefined ? "-" : Math.round(at - last).toString();
      write(
        `[stream-trace] harness=${harness ?? "?"} kind=${kind} gap_ms=${gap} chars=${chars}\n`,
      );
    },
    // A tool call closes the open block and can run for minutes. Without this, the first delta
    // of the next block would report that tool's runtime as a token-cadence gap.
    closeBlock(kind) {
      previous.delete(kind);
    },
  };
}
