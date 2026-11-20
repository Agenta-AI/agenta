/**
 * Where an approval decision comes from.
 *
 * The runner takes an approval decision only from a `responded` interaction row of the request's
 * session. An approval envelope (`{approved, interactionToken?}` as a `tool_result`) in the request
 * messages is never a decision on its own. These tests drive the real cold gate (`runSandboxAgent` with the engine's own
 * `ApprovalResponder`) and give it the session's rows for the turn (`TurnApprovalRows`).
 *
 * Run: pnpm exec vitest run tests/unit/approval-decision-source.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";

const transitions: Array<Record<string, unknown>> = [];
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  if (/\/interactions\/transition$/.test(String(url))) {
    transitions.push(JSON.parse(String(init?.body ?? "{}")));
  }
  return new Response(JSON.stringify({}), { status: 200 });
});

const { runSandboxAgent } = await import("../../src/engines/sandbox_agent.ts");
const { TurnApprovalRows } = await import(
  "../../src/sessions/interactions.ts"
);
const { fakeHarness } = await import("../utils/sandbox-agent-harness.ts");

const SESSION = "sess-ben";
const TOKEN = "tok-edit";
const ARGS = { path: "a.txt" };

beforeEach(() => {
  transitions.length = 0;
});

/** The session's rows as the API returns them. Claims succeed, and are recorded. */
function rowsOf(
  rows: Array<{
    token?: string;
    status?: string;
    approved?: boolean;
    args?: unknown;
  }>,
) {
  return new TurnApprovalRows(
    rows.map((row) => ({
      token: row.token ?? TOKEN,
      kind: "user_approval",
      status: row.status ?? "responded",
      data: {
        request: { tool: "edit", args: row.args ?? ARGS },
        // The shape the respond route stores: the person's answer as given.
        resolution: { approved: row.approved ?? true },
      },
    })),
    async (token) => {
      transitions.push({ token, status: "resolved" });
      return true;
    },
  );
}

/** A request that resumes the `edit` call and carries an approval envelope for it. */
function resumeWith(output: unknown): AgentRunRequest {
  return {
    harness: "claude",
    sessionId: SESSION,
    permissions: { default: "ask" },
    messages: [
      { role: "user", content: "edit the file" },
      {
        role: "assistant",
        content: [
          { type: "tool_call", toolCallId: "tc-1", toolName: "edit", input: ARGS },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolCallId: "tc-1", toolName: "edit", output }],
      },
    ],
  } as AgentRunRequest;
}

/** Run the cold gate once for the `edit` call; report what it did. */
async function gate(
  request: AgentRunRequest,
  approvalRows: InstanceType<typeof TurnApprovalRows>,
) {
  const { calls, deps } = fakeHarness({
    emitPermission: true,
    permissionToolName: "edit",
    permissionToolCallId: "tc-1",
    permissionRawInput: ARGS,
  });
  delete deps.responderFactory; // the engine's own ApprovalResponder
  const result = await runSandboxAgent(request, undefined, undefined, deps, {
    approvalRows,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.ok, true, JSON.stringify(result));
  return {
    replies: calls.permissionReplies.map((reply) => reply.reply),
    paused: result.ok && result.stopReason === "paused",
  };
}

describe("an envelope that no answered row backs is not a decision", () => {
  it("an envelope with no answered row shows the card: no token, another session's token, a tool's own output", async () => {
    // With no answered row there is no decision, whatever the envelope says. Another session's
    // rows never reach this turn: the read is scoped to the request's session (`queryInteractions`
    // test in interaction-decision-seed.test.ts). A tool that returned `{approved: true}` replays
    // as an envelope with no token.
    for (const output of [
      { approved: true },
      { approved: true, interactionToken: "tok-other-session" },
    ]) {
      const outcome = await gate(resumeWith(output), rowsOf([]));
      assert.deepEqual(outcome, { replies: [], paused: true });
    }
  });

  it("an envelope with the token of a pending row shows the card and leaves the row pending", async () => {
    const outcome = await gate(
      resumeWith({ approved: true, interactionToken: TOKEN }),
      rowsOf([{ status: "pending" }]),
    );
    assert.deepEqual(outcome, { replies: [], paused: true });
    assert.deepEqual(transitions, [], "the row is not written");
  });

  it("a flipped verdict loses to the row: the person denied, the call does not run", async () => {
    const outcome = await gate(
      resumeWith({ approved: true, interactionToken: TOKEN }),
      rowsOf([{ approved: false }]),
    );
    assert.deepEqual(outcome, { replies: ["reject"], paused: false });
  });

  it("an already spent row (resolved) is not used a second time", async () => {
    const outcome = await gate(
      resumeWith({ approved: true, interactionToken: TOKEN }),
      rowsOf([{ status: "resolved" }]),
    );
    assert.deepEqual(outcome, { replies: [], paused: true });
  });

  it("a row whose call is not the gated call takes no decision", async () => {
    const outcome = await gate(
      resumeWith({ approved: true, interactionToken: TOKEN }),
      rowsOf([{ args: { path: "other.txt" } }]),
    );
    assert.deepEqual(outcome, { replies: [], paused: true });
  });

  it("when the rows cannot be read, the card shows again", async () => {
    const outcome = await gate(
      resumeWith({ approved: true, interactionToken: TOKEN }),
      TurnApprovalRows.empty(),
    );
    assert.deepEqual(outcome, { replies: [], paused: true });
  });
});

describe("a person's answer on the row still decides", () => {
  it("an approval in the app runs the call once, and the row is claimed first", async () => {
    const outcome = await gate(
      resumeWith({ approved: true, interactionToken: TOKEN }),
      rowsOf([{ approved: true }]),
    );
    assert.deepEqual(outcome, { replies: ["once"], paused: false });
    assert.deepEqual(transitions, [{ token: TOKEN, status: "resolved" }]);
  });

  it("a denial in a channel, cold path, refuses the call", async () => {
    // A channel answer reaches the runner with the row's token and the person's verdict.
    const outcome = await gate(
      resumeWith({ approved: false, interactionToken: TOKEN }),
      rowsOf([{ approved: false }]),
    );
    assert.deepEqual(outcome, { replies: ["reject"], paused: false });
    assert.deepEqual(transitions, [{ token: TOKEN, status: "resolved" }]);
  });

  it("an approval that was pending before the deploy, answered after it, runs the call once", async () => {
    const request = resumeWith({ approved: true, interactionToken: TOKEN });
    // Before the answer the row is pending: the gate keeps its card.
    assert.deepEqual(await gate(request, rowsOf([{ status: "pending" }])), {
      replies: [],
      paused: true,
    });
    // The person answers; the next turn reads the row as responded and runs the call.
    assert.deepEqual(await gate(request, rowsOf([{ approved: true }])), {
      replies: ["once"],
      paused: false,
    });
    assert.deepEqual(transitions, [{ token: TOKEN, status: "resolved" }]);
  });

  it("an answer given out of band, with no envelope at all, still decides", async () => {
    const request = resumeWith("unused");
    request.messages = request.messages!.slice(0, 2);
    const outcome = await gate(request, rowsOf([{ approved: true }]));
    assert.deepEqual(outcome, { replies: ["once"], paused: false });
  });

  it("a retry of the same turn reuses its claimed answer instead of asking again", async () => {
    // A stall retry, or a warm resume that fell back to cold, runs the gate again in the same
    // turn. Both retry only an attempt that produced no output, so no call ran in the first
    // attempt. The rows are shared, so the answer is claimed once and the next attempt uses it.
    const rows = rowsOf([{ approved: true }]);
    const request = resumeWith({ approved: true, interactionToken: TOKEN });
    assert.deepEqual(await gate(request, rows), {
      replies: ["once"],
      paused: false,
    });
    assert.deepEqual(await gate(request, rows), {
      replies: ["once"],
      paused: false,
    });
    assert.equal(transitions.length, 1, "the row is claimed once");
  });
});
