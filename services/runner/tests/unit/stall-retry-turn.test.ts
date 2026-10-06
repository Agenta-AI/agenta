/**
 * The TTFB stall retry, driven through the REAL engine and tracer (`runSilentTurn`).
 *
 * `stall-retry.test.ts` pins the retry loop against fake attempts. These pin what that loop
 * depends on from a real turn:
 *
 * - which frames a stalled attempt sends the caller, and that the caller sees exactly one turn
 *   ending across a retry (the stalled attempt's `error` and `done` never reach it);
 * - that an approval reply is never marked re-promptable, because its decision is already spent;
 * - that a non-streaming turn which is answering is not mistaken for a stall.
 *
 * Run: pnpm exec vitest run tests/unit/stall-retry-turn.test.ts
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent, AgentRunResult } from "../../src/protocol.ts";
import { runWithStallRetry } from "../../src/lifecycle/stall-retry.ts";
import {
  enableDaytonaProvider,
  runSilentTurn,
  textChunk,
} from "../utils/silent-turn.ts";

// The hermetic setup answers every records query with an empty log. The approval reply below needs
// a prior turn to rebuild, so this suite answers with `priorRecords.rows` instead.
const priorRecords = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../../src/sessions/records-query.ts", () => ({
  fetchSessionRecords: async () => priorRecords.rows,
}));

/** TTFB is the shortest window, so a silent harness trips it first. */
const STALL_LIMITS = { totalMs: 5000, idleMs: 400, ttfbMs: 100, toolCallMs: 5000 };

const TERMINAL = new Set(["error", "done"]);

function types(events: AgentEvent[]): string[] {
  return events.map((event) => event.type);
}

beforeEach(enableDaytonaProvider);

afterEach(() => {
  priorRecords.rows = [];
});

describe("a turn that stalls before its first response", () => {
  it("sends the caller only setup status before its error and done", async () => {
    const { result, events } = await runSilentTurn(
      {},
      { hang: true, runLimits: STALL_LIMITS },
    );

    assert.equal(result.ok, false);
    assert.equal(result.stalledBeforeFirstResponse, true);
    // Everything before the terminal frames is transient setup status. This is what lets the
    // dispatch hold the terminal frames of an attempt it may retry: nothing else went out.
    const leading = events.slice(0, -2);
    assert.ok(leading.length > 0);
    for (const event of leading) {
      assert.equal(event.type, "data");
      assert.equal((event as { transient?: boolean }).transient, true);
    }
    assert.deepEqual(types(events.slice(-2)), ["error", "done"]);
  });

  it("shows the caller one done and no error when the retry answers", async () => {
    const caller: AgentEvent[] = [];
    let attempt = 0;

    const result = await runWithStallRetry(
      async (emit) => {
        attempt += 1;
        const stalls = attempt === 1;
        const run = await runSilentTurn(
          {},
          {
            emit: emit ?? null,
            runLimits: STALL_LIMITS,
            ...(stalls
              ? { hang: true }
              : { promptEvents: [textChunk("the answer")] }),
          },
        );
        return run.result as AgentRunResult;
      },
      { emit: (event) => caller.push(event), retries: 1 },
    );

    assert.equal(attempt, 2);
    assert.equal(result.ok, true);
    const callerTypes = types(caller);
    assert.ok(!callerTypes.includes("error"), callerTypes.join(","));
    assert.equal(callerTypes.filter((type) => type === "done").length, 1);
    assert.equal(callerTypes.at(-1), "done");
    assert.ok(callerTypes.includes("message_delta"));
    const done = caller.at(-1) as { stopReason?: string };
    assert.equal(done.stopReason, undefined, "the answered turn ends as a completed turn");
  });

  it("still shows the caller its error and done when the budget is spent", async () => {
    const caller: AgentEvent[] = [];
    let attempt = 0;

    const result = await runWithStallRetry(
      async (emit) => {
        attempt += 1;
        const run = await runSilentTurn(
          {},
          { emit: emit ?? null, hang: true, runLimits: STALL_LIMITS },
        );
        return run.result as AgentRunResult;
      },
      { emit: (event) => caller.push(event), retries: 1 },
    );

    assert.equal(attempt, 2);
    assert.equal(result.ok, false);
    assert.ok(!("stalledBeforeFirstResponse" in result));
    // Only the final attempt's ending reaches the caller: one error, then one done.
    const terminal = caller.filter((event) => TERMINAL.has(event.type));
    assert.deepEqual(types(terminal), ["error", "done"]);
    assert.deepEqual(types(caller.slice(-2)), ["error", "done"]);
  });
});

describe("an approval reply that stalls", () => {
  it("is not marked re-promptable, because its decision is already spent", async () => {
    // The prior turn, as the records endpoint returns it: the approval reply carries no user text,
    // so the engine rebuilds the conversation from these.
    priorRecords.rows = [
      {
        record_source: "user",
        turn_id: "turn-1",
        attributes: { type: "message", text: "edit the file" },
      },
      {
        record_source: "agent",
        turn_id: "turn-1",
        attributes: { type: "tool_call", id: "tool-1", name: "edit", input: {} },
      },
    ];

    const { result } = await runSilentTurn(
      {
        turnId: "turn-2",
        messages: [
          {
            role: "tool",
            content: [
              {
                type: "tool_result",
                toolCallId: "tool-1",
                toolName: "edit",
                output: { approved: true },
              },
            ],
          },
        ],
      },
      { hang: true, runLimits: STALL_LIMITS },
    );

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /did not start responding within/);
    assert.equal(result.stalledBeforeFirstResponse, undefined);
  });
});

describe("a non-streaming turn", () => {
  it("counts its text as progress, so a slow answer is not a stall", async () => {
    // No live sink: the tracer coalesces text instead of recording each delta. The text must
    // still cancel TTFB, or this turn would read as one that never started and be re-prompted.
    const { result } = await runSilentTurn(
      {},
      {
        emit: null,
        hang: true,
        promptEvents: [textChunk("partial answer")],
        runLimits: STALL_LIMITS,
      },
    );

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /made no progress for/);
    assert.equal(result.stalledBeforeFirstResponse, undefined);
  });

  it("still gets coalesced events back on its result", async () => {
    const { result, events } = await runSilentTurn(
      {},
      { emit: null, promptEvents: [textChunk("the answer")] },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(events, [], "nothing streams without a sink");
    const resultTypes = types(result.events ?? []);
    assert.ok(resultTypes.includes("message"), resultTypes.join(","));
    assert.ok(!resultTypes.includes("message_delta"));
    assert.equal(resultTypes.at(-1), "done");
  });
});
