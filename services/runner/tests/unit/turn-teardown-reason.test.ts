/**
 * The teardown reason a one-turn environment gets once its turn ends. The reason decides park or
 * delete (`teardown.ts`).
 *
 * `runSandboxAgent` (the cold engine entry) uses `turnTeardownReason`, so a turn another runner
 * already wrote tears down as `continuity-invalid` (parks), never `failed-turn` (deletes).
 *
 * The keep-alive engine's `runCold` in `server.ts` uses `unpooledTeardownReason` instead, and
 * every one of its endings deletes. The coordinator sends a run there only when it cannot pool
 * it, and a stopped sandbox with no pool entry leaked itself and its Daytona Secrets: observed
 * on 2026-10-19 for a Daytona `/run` with a `sessionId` and no `runContext.project.id`.
 *
 * `runCold` is driven through `makeKeepaliveEngine` with `acquireEnvironment` and `runTurn`
 * replaced, so the test reads the exact reason passed to `destroy`.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/turn-teardown-reason.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

import type { AgentRunRequest, AgentRunResult } from "../../src/protocol.ts";
import type { TeardownReason } from "../../src/engines/sandbox_agent/teardown.ts";
import {
  TURN_INDEX_TAKEN_CODE,
  TURN_INDEX_TAKEN_MESSAGE,
} from "../../src/engines/sandbox_agent/errors.ts";
import {
  turnTeardownReason,
  unpooledTeardownReason,
} from "../../src/engines/sandbox_agent/engine.ts";
import { teardownDisposition } from "../../src/engines/sandbox_agent/teardown.ts";
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

describe("unpooledTeardownReason", () => {
  it("never names a reason that parks", () => {
    const endings: Array<[AgentRunResult | undefined, AbortSignal | undefined, (() => boolean) | undefined]> = [
      [COMPLETED, undefined, undefined],
      [{ ...COMPLETED, stopReason: "cancelled", cancelSettled: true }, undefined, undefined],
      [{ ...COMPLETED, stopReason: "paused" }, undefined, undefined],
      [TURN_INDEX_TAKEN, undefined, undefined],
      [FAILED, undefined, undefined],
      [undefined, undefined, undefined],
      [COMPLETED, abortedSignal(), undefined],
      [COMPLETED, undefined, () => true],
    ];
    for (const [result, signal, clientGone] of endings) {
      const reason = unpooledTeardownReason(result, signal, clientGone);
      assert.equal(teardownDisposition(reason), "delete", reason);
    }
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
      name: "a turn another runner already wrote deletes as failed-turn",
      turn: async () => TURN_INDEX_TAKEN,
      reason: "failed-turn",
    },
    {
      name: "an ordinary failed turn deletes as failed-turn",
      turn: async () => FAILED,
      reason: "failed-turn",
    },
    {
      name: "a completed turn deletes as unpooled, even in a resumable environment",
      turn: async () => COMPLETED,
      reason: "unpooled",
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
      assert.equal(teardownDisposition(reason), "delete");
    });
  }

  it("a client that left mid-turn deletes as aborted", async () => {
    mocks.runTurn.mockResolvedValue(COMPLETED);

    await makeKeepaliveEngine(() => ({})).runCold(
      REQUEST,
      undefined,
      undefined,
      undefined,
      () => true,
    );
    assert.deepEqual(destroyed, ["aborted"]);
  });

  it("a runTurn that threw deletes as failed-turn", async () => {
    mocks.runTurn.mockRejectedValue(new Error("harness crashed"));

    await assert.rejects(runCold(), /harness crashed/);
    assert.deepEqual(destroyed, ["failed-turn"]);
  });
});
