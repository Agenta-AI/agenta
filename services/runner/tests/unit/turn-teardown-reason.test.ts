/**
 * The teardown reason a one-turn environment gets once its turn ends. Both one-turn paths share
 * `turnTeardownReason`: `runSandboxAgent` (the cold engine entry) and the keep-alive engine's
 * `runCold` in `server.ts`. The reason decides park or delete (`teardown.ts`), so a turn another
 * runner already wrote must tear down as `continuity-invalid` (parks), never `failed-turn`
 * (deletes).
 *
 * `runCold` is driven through `makeKeepaliveEngine` with `acquireEnvironment` and `runTurn`
 * replaced, so the test reads the exact reason passed to `destroy`.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/one-turn-teardown-reason.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

import type { AgentRunRequest, AgentRunResult } from "../../src/protocol.ts";
import type { TeardownReason } from "../../src/engines/sandbox_agent/teardown.ts";
import {
  TURN_INDEX_TAKEN_CODE,
  TURN_INDEX_TAKEN_MESSAGE,
} from "../../src/engines/sandbox_agent/errors.ts";
import { turnTeardownReason } from "../../src/engines/sandbox_agent/engine.ts";
import { makeKeepaliveEngine } from "../../src/server.ts";

const mocks = vi.hoisted(() => ({
  acquireEnvironment: vi.fn(),
  runTurn: vi.fn(),
}));

vi.mock("../../src/engines/sandbox_agent.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/engines/sandbox_agent.ts")>()),
  acquireEnvironment: mocks.acquireEnvironment,
  runTurn: mocks.runTurn,
}));

const REQUEST: AgentRunRequest = {
  harness: "claude",
  sandbox: "daytona",
  messages: [{ role: "user", content: "hello" }],
};

const COMPLETED: AgentRunResult = { ok: true, output: "answer", stopReason: "end_turn" };
const FAILED: AgentRunResult = { ok: false, error: "provider refused the turn" };
const TURN_INDEX_TAKEN: AgentRunResult = {
  ok: false,
  error: TURN_INDEX_TAKEN_MESSAGE,
  errorDetail: {
    code: TURN_INDEX_TAKEN_CODE,
    message: TURN_INDEX_TAKEN_MESSAGE,
    retryable: true,
    next_step: "Send the message again.",
  },
};

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

describe("turnTeardownReason", () => {
  it("a turn another runner already wrote is continuity-invalid", () => {
    assert.equal(
      turnTeardownReason(TURN_INDEX_TAKEN, true, undefined, undefined),
      "continuity-invalid",
    );
  });

  it("an ordinary failed turn is failed-turn", () => {
    assert.equal(
      turnTeardownReason(FAILED, true, undefined, undefined),
      "failed-turn",
    );
  });

  it("a completed turn in a resumable environment is clean-resumable", () => {
    assert.equal(
      turnTeardownReason(COMPLETED, true, undefined, undefined),
      "clean-resumable",
    );
  });

  it("an aborted signal is aborted", () => {
    assert.equal(
      turnTeardownReason(COMPLETED, true, abortedSignal(), undefined),
      "aborted",
    );
  });

  it("a client that left mid-turn is aborted", () => {
    assert.equal(
      turnTeardownReason(COMPLETED, true, undefined, () => true),
      "aborted",
    );
  });

  it("a runTurn that threw (no result) is failed-turn", () => {
    assert.equal(
      turnTeardownReason(undefined, true, undefined, undefined),
      "failed-turn",
    );
  });
});

describe("keep-alive engine runCold teardown", () => {
  let destroyed: TeardownReason[];

  beforeEach(() => {
    destroyed = [];
    mocks.acquireEnvironment.mockReset();
    mocks.runTurn.mockReset();
    mocks.acquireEnvironment.mockResolvedValue({
      ok: true,
      env: {
        resumable: true,
        loadedFromContinuity: false,
        nativeHistoryVerified: false,
        // No session id: the pre-turn durable-decision read returns [] without a request.
        sessionId: undefined,
        logger: () => {},
        destroy: async ({ reason }: { reason: TeardownReason }) => {
          destroyed.push(reason);
        },
      },
    });
  });

  const runCold = (signal?: AbortSignal) =>
    makeKeepaliveEngine(() => ({})).runCold(REQUEST, undefined, signal);

  const cases: Array<{
    name: string;
    turn: () => Promise<AgentRunResult>;
    signal?: () => AbortSignal;
    reason: TeardownReason;
  }> = [
    {
      name: "a turn another runner already wrote parks as continuity-invalid",
      turn: async () => TURN_INDEX_TAKEN,
      reason: "continuity-invalid",
    },
    {
      name: "an ordinary failed turn deletes as failed-turn",
      turn: async () => FAILED,
      reason: "failed-turn",
    },
    {
      name: "a completed turn parks as clean-resumable",
      turn: async () => COMPLETED,
      reason: "clean-resumable",
    },
    {
      name: "an aborted signal deletes as aborted",
      turn: async () => COMPLETED,
      signal: abortedSignal,
      reason: "aborted",
    },
  ];

  for (const { name, turn, signal, reason } of cases) {
    it(name, async () => {
      const expected = await turn();
      mocks.runTurn.mockImplementation(turn);

      const result = await runCold(signal?.());

      assert.deepEqual(result, expected);
      assert.deepEqual(destroyed, [reason]);
    });
  }

  it("a runTurn that threw deletes as failed-turn", async () => {
    mocks.runTurn.mockRejectedValue(new Error("harness crashed"));

    await assert.rejects(runCold(), /harness crashed/);
    assert.deepEqual(destroyed, ["failed-turn"]);
  });
});
