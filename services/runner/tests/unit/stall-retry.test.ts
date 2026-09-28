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

import type { AgentRunResult } from "../../src/protocol.ts";
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
