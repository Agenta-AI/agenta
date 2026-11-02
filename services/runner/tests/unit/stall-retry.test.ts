/**
 * Unit tests for re-prompting a turn that stalled before its first response (`stall-retry.ts`).
 *
 * The behaviour under test is narrow on purpose: a stalled-before-anything turn is the ONLY failure
 * the dispatch may replay, because it is the only one that provably did nothing. These pin both
 * halves — that such a turn is retried, and that nothing else is.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/stall-retry.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type {
  AgentEvent,
  AgentRunResult,
  EmitEvent,
} from "../../src/protocol.ts";
import {
  DEFAULT_TTFB_RETRIES,
  TTFB_RETRIES_ENV,
  resolveStallRetries,
  runWithStallRetry,
} from "../../src/lifecycle/stall-retry.ts";

const stalled: AgentRunResult = {
  ok: false,
  error: "no first response within 120000ms of run start",
  stalledBeforeFirstResponse: true,
};
const answered: AgentRunResult = { ok: true, output: "hello" };

/** Returns a fake attempt that yields each result in turn, and the call count so far. */
function attempts(...results: AgentRunResult[]) {
  let calls = 0;
  return {
    attempt: async (): Promise<AgentRunResult> => {
      const result = results[Math.min(calls, results.length - 1)];
      calls++;
      return result;
    },
    calls: () => calls,
  };
}

function withEnv(value: string | undefined, run: () => void): void {
  const previous = process.env[TTFB_RETRIES_ENV];
  if (value === undefined) delete process.env[TTFB_RETRIES_ENV];
  else process.env[TTFB_RETRIES_ENV] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[TTFB_RETRIES_ENV];
    else process.env[TTFB_RETRIES_ENV] = previous;
  }
}

describe("stall retry", () => {
  it("re-prompts a stalled turn and returns the answer the retry produced", async () => {
    const { attempt, calls } = attempts(stalled, answered);
    const logs: string[] = [];

    const result = await runWithStallRetry(attempt, {
      retries: 1,
      log: (message) => logs.push(message),
    });

    assert.equal(calls(), 2);
    assert.deepEqual(result, answered);
    // The retry is logged, so a stall that recovered is still visible in the runner's evidence.
    assert.equal(logs.length, 1);
    assert.match(logs[0], /re-prompting \(attempt 2\/2\)/);
  });

  it("does not retry a failure that is not a pre-first-response stall", async () => {
    // Anything that emitted before failing may have run a tool or answered in part, so replaying
    // it could repeat that work. Only the explicit flag authorises a retry.
    const failed: AgentRunResult = { ok: false, error: "the model refused" };
    const { attempt, calls } = attempts(failed, answered);

    const result = await runWithStallRetry(attempt, { retries: 1 });

    assert.equal(calls(), 1);
    assert.deepEqual(result, failed);
  });

  it("does not retry a turn the user stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const { attempt, calls } = attempts(stalled, answered);

    const result = await runWithStallRetry(attempt, {
      retries: 1,
      signal: controller.signal,
    });

    assert.equal(calls(), 1, "an aborted turn must not be re-prompted");
    assert.equal(result.ok, false);
  });

  it("gives up after the budget and never leaks the flag to the caller", async () => {
    const { attempt, calls } = attempts(stalled);

    const result = await runWithStallRetry(attempt, { retries: 1 });

    assert.equal(calls(), 2, "one attempt plus one retry");
    assert.equal(result.ok, false);
    // The flag is this dispatch's own signal. A caller that saw it could retry a turn already
    // given up on, so the user-facing failure must not carry it.
    assert.equal(result.stalledBeforeFirstResponse, undefined);
    assert.ok(!("stalledBeforeFirstResponse" in result));
    // The error the user reads survives the retry.
    assert.equal(result.error, stalled.error);
  });

  it("honours a zero budget by not retrying at all", async () => {
    const { attempt, calls } = attempts(stalled);

    const result = await runWithStallRetry(attempt, { retries: 0 });

    assert.equal(calls(), 1);
    assert.ok(!("stalledBeforeFirstResponse" in result));
  });

  it("retries more than once when the budget allows", async () => {
    const { attempt, calls } = attempts(stalled, stalled, answered);

    const result = await runWithStallRetry(attempt, { retries: 2 });

    assert.equal(calls(), 3);
    assert.deepEqual(result, answered);
  });

  it("reads the budget from the environment, clamped to a small range", () => {
    withEnv(undefined, () =>
      assert.equal(resolveStallRetries(), DEFAULT_TTFB_RETRIES),
    );
    withEnv("0", () => assert.equal(resolveStallRetries(), 0));
    withEnv("2", () => assert.equal(resolveStallRetries(), 2));
    // Each retry is a full cold sandbox rebuild, so an over-large override is clamped rather
    // than honoured.
    withEnv("99", () => assert.equal(resolveStallRetries(), 3));
    withEnv("nonsense", () =>
      assert.equal(resolveStallRetries(), DEFAULT_TTFB_RETRIES),
    );
  });
});

const status: AgentEvent = {
  type: "data",
  name: "agent-status",
  data: { phase: "environment_ready" },
  transient: true,
};
const stallError: AgentEvent = { type: "error", message: "no first response" };
const failedDone: AgentEvent = { type: "done", stopReason: "error" };
const delta: AgentEvent = { type: "message_delta", id: "m1", delta: "hi" };
const done: AgentEvent = { type: "done" };

/** One scripted attempt: the frames it sends, then the result it returns. */
interface Script {
  frames: AgentEvent[];
  result: AgentRunResult;
}

/** Plays each script on its own attempt and records every frame the caller receives. */
function scripted(...scripts: Script[]) {
  const caller: AgentEvent[] = [];
  let calls = 0;
  const attempt = async (emit: EmitEvent | undefined) => {
    const script = scripts[Math.min(calls, scripts.length - 1)];
    calls++;
    for (const frame of script.frames) emit?.(frame);
    return script.result;
  };
  return {
    attempt,
    emit: (event: AgentEvent) => caller.push(event),
    caller,
    calls: () => calls,
  };
}

const stalledAttempt: Script = {
  frames: [status, stallError, failedDone],
  result: stalled,
};
const answeredAttempt: Script = {
  frames: [status, delta, done],
  result: answered,
};

describe("stall retry: what the caller sees", () => {
  it("drops a retried attempt's error and done, and keeps its setup status", async () => {
    const run = scripted(stalledAttempt, answeredAttempt);

    const result = await runWithStallRetry(run.attempt, {
      emit: run.emit,
      retries: 1,
    });

    assert.deepEqual(result, answered);
    // Setup status went out live for both attempts; only the answered attempt's ending did.
    assert.deepEqual(run.caller, [status, status, delta, done]);
  });

  it("delivers the error and done of a stall that is not retried", async () => {
    const run = scripted(stalledAttempt);

    await runWithStallRetry(run.attempt, { emit: run.emit, retries: 1 });

    assert.equal(run.calls(), 2);
    // The first attempt's ending is dropped; the last one's reaches the caller, in order.
    assert.deepEqual(run.caller, [status, status, stallError, failedDone]);
  });

  it("delivers the ending at once when there is no budget to retry", async () => {
    const seen: AgentEvent[] = [];
    let seenBeforeReturn: AgentEvent[] = [];
    await runWithStallRetry(
      async (emit) => {
        for (const frame of stalledAttempt.frames) emit?.(frame);
        seenBeforeReturn = [...seen];
        return stalled;
      },
      { emit: (event) => seen.push(event), retries: 0 },
    );

    assert.deepEqual(seenBeforeReturn, stalledAttempt.frames);
  });

  it("delivers a turn's done live once it has sent any conversation", async () => {
    // A cold attempt tears its sandbox down before it returns. Holding `done` until then would
    // make every answered turn end late, so `done` must go out as soon as it is emitted.
    const seen: AgentEvent[] = [];
    let seenBeforeReturn: AgentEvent[] = [];
    await runWithStallRetry(
      async (emit) => {
        for (const frame of answeredAttempt.frames) emit?.(frame);
        seenBeforeReturn = [...seen];
        return answered;
      },
      { emit: (event) => seen.push(event), retries: 1 },
    );

    assert.deepEqual(seenBeforeReturn, answeredAttempt.frames);
  });

  it("delivers the ending live for a turn the user stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const seen: AgentEvent[] = [];
    let seenBeforeReturn: AgentEvent[] = [];
    const cancelledDone: AgentEvent = { type: "done", stopReason: "cancelled" };
    await runWithStallRetry(
      async (emit) => {
        emit?.(cancelledDone);
        seenBeforeReturn = [...seen];
        return { ok: true, output: "", stopReason: "cancelled" };
      },
      { emit: (event) => seen.push(event), retries: 1, signal: controller.signal },
    );

    assert.deepEqual(seenBeforeReturn, [cancelledDone]);
  });

  it("releases a held error, in order, when the attempt keeps going", async () => {
    const run = scripted({
      frames: [status, stallError, delta, done],
      result: answered,
    });

    await runWithStallRetry(run.attempt, { emit: run.emit, retries: 1 });

    assert.deepEqual(run.caller, [status, stallError, delta, done]);
  });

  it("releases held frames when the attempt throws", async () => {
    const seen: AgentEvent[] = [];

    await assert.rejects(
      runWithStallRetry(
        async (emit) => {
          emit?.(stallError);
          emit?.(failedDone);
          throw new Error("boom");
        },
        { emit: (event) => seen.push(event), retries: 1 },
      ),
      /boom/,
    );

    assert.deepEqual(seen, [stallError, failedDone]);
  });

  it("never retries an attempt whose ending already reached the caller", async () => {
    // Defensive: a result flagged as a stall after it streamed must not be replayed, because the
    // caller has already seen this turn end.
    const run = scripted(
      { frames: [delta, stallError, failedDone], result: stalled },
      answeredAttempt,
    );

    const result = await runWithStallRetry(run.attempt, {
      emit: run.emit,
      retries: 1,
    });

    assert.equal(run.calls(), 1);
    assert.equal(result.ok, false);
    assert.ok(!("stalledBeforeFirstResponse" in result));
    assert.deepEqual(run.caller, [delta, stallError, failedDone]);
  });

  it("passes no sink to an attempt when the caller does not stream", async () => {
    const sinks: Array<EmitEvent | undefined> = [];
    await runWithStallRetry(
      async (emit) => {
        sinks.push(emit);
        return sinks.length === 1 ? stalled : answered;
      },
      { retries: 1 },
    );

    assert.deepEqual(sinks, [undefined, undefined]);
  });
});
