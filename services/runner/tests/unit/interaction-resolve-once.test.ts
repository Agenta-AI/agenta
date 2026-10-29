/**
 * A durable interaction row is transitioned ONCE per turn.
 *
 * Two paths can answer the same row and they do not share a memory. The CALLER claims it:
 * `loadDurableDecisions` resolves the row before adopting its decision, and hands the decision in
 * through `RunTurnOptions.seededDecisions`. The TURN then settles its in-band answers at the end
 * (`settleInBandInteractions`), and a resume carries that same answer in its transcript — so the
 * turn tried to resolve a row the caller had already made terminal.
 *
 * Live, that put `[sessions/interactions] resolve failed ... HTTP 404` in the log of every
 * HEALTHY approve/deny (observed 2026-08-27 on sessions 6dd74afc and 4a49f0f9, each ~9s after a
 * `resolve OK` for the same token). Nothing was broken by it, which is exactly the problem: an
 * error line that always appears teaches whoever reads these logs to skip it, and the next one
 * will be real.
 *
 * Run: pnpm exec vitest run tests/unit/interaction-resolve-once.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

const transitions: Array<Record<string, unknown>> = [];

vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  if (/\/interactions\/transition$/.test(String(url))) {
    transitions.push(body as Record<string, unknown>);
  }
  return new Response(JSON.stringify({}), { status: 200 });
});

const { acquireEnvironment, runSandboxAgent, runTurn } = await import(
  "../../src/engines/sandbox_agent.ts"
);
const { fakeHarness } = await import("../utils/sandbox-agent-harness.ts");

const TOKEN = "tok-gate-1";
const TOOL_CALL_ID = "toolu_write_1";
const SESSION = "sess-resolve-once";

/** A resume whose transcript already carries the human's answer, tagged with its row token. */
function resumeRequest(): any {
  return {
    sessionId: SESSION,
    harness: "claude",
    sandbox: "local",
    telemetry: {
      exporters: { otlp: { headers: { authorization: "ApiKey test-cred" } } },
    },
    messages: [
      { role: "user", content: "write out.txt" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            toolCallId: TOOL_CALL_ID,
            toolName: "Write",
            input: { path: "out.txt" },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_result",
            toolCallId: TOOL_CALL_ID,
            toolName: "Write",
            output: { approved: true, interactionToken: TOKEN },
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  transitions.length = 0;
});

describe("a row the caller already claimed", () => {
  it("is not transitioned again by the turn's in-band settle", async () => {
    const { deps } = fakeHarness();

    const result = await runSandboxAgent(
      resumeRequest(),
      undefined,
      undefined,
      deps,
      {
        // What `loadDurableDecisions` hands in AFTER it has resolved the row.
        seededDecisions: [
          {
            key: "Write#{}",
            decision: { decision: "allow", interactionToken: TOKEN },
            token: TOKEN,
          },
        ],
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      transitions.filter((t) => t.token === TOKEN),
      [],
      "the caller already claimed this row; a second transition can only 404",
    );
  });

  it("still settles an in-band answer the caller did NOT claim", async () => {
    // The guard must be scoped to claimed tokens, not a blanket skip: an answer that arrived
    // only in band still has a pending row, and settling it is what keeps a cold replay's gate
    // from staying forever-actionable.
    const { deps } = fakeHarness();

    const result = await runSandboxAgent(
      resumeRequest(),
      undefined,
      undefined,
      deps,
      {},
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      transitions
        .filter((t) => t.token === TOKEN)
        .map((t) => (t.resolution as { verdict?: string })?.verdict),
      ["approved"],
      "an unclaimed in-band answer is still resolved exactly once, with its verdict",
    );
  });

  it("still EMITS interaction_response when a claimed gate is answered this turn", async () => {
    // The contract this pins: the guard skips the durable TRANSITION, never the event. The row
    // is state and is already terminal; the event is a notification to a client that may never
    // have seen one, and suppressing it strands the approval part in the UI while the run moves
    // on. Without this test, "simplify" the guard into a full no-op for claimed tokens and both
    // cases above still pass while the UI silently breaks.
    // `run.emitEvent` is the transcript's, not the caller's `emit`, so read the harness array.
    const { deps, events } = fakeHarness();
    const request = resumeRequest();
    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    const result = await runTurn(
      acquired.env,
      request,
      undefined,
      undefined,
      {
        seededDecisions: [
          {
            key: "Write#{}",
            decision: { decision: "allow", interactionToken: TOKEN },
            token: TOKEN,
          },
        ],
        resume: {
          decisions: [
            {
              permissionId: "perm-1",
              reply: "once",
              toolCallId: TOOL_CALL_ID,
              toolName: "Write",
              args: {},
              interactionToken: TOKEN,
              promptPromise: Promise.resolve({ stopReason: "complete" }),
            },
          ],
          carriedForward: [],
        },
      },
    );

    assert.equal(result.ok, true);
    const responses = events.filter(
      (event): event is Extract<
        (typeof events)[number],
        { type: "interaction_response" }
      > => event.type === "interaction_response",
    );
    assert.deepEqual(
      responses
        .filter((event) => event.id === TOKEN)
        .map((event) => (event.payload as { approved?: boolean })?.approved),
      [true],
      "the answer must still reach the client as an interaction_response",
    );
    assert.deepEqual(
      transitions.filter((t) => t.token === TOKEN),
      [],
      "and it must still not transition a row the caller already claimed",
    );
  });
});
