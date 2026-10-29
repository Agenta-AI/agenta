/**
 * The orphaned-gate settle: a resume must not leave its durable row `pending` forever.
 *
 * A resume delivers the human's yes/no as a `tool_result` approval envelope. When the harness
 * re-raises the gate, the reply path resolves the row. When it does NOT — a cold replay whose
 * transcript already contains the answer, so the agent simply proceeds — nothing else ever
 * touches the row. The turn-start stale sweep can't cover it either: it EXEMPTS exactly this
 * token (server.ts `staleInteractionExemptTokens`) on the promise that the resume will resolve
 * it. That promise is what breaks when the resume degrades to cold, and the row is left
 * forever-actionable in both inboxes.
 *
 * `extractInBandApprovalAnswers` is the list the turn settles from at its end.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { extractInBandApprovalAnswers } from "../../src/responder.ts";

const TOKEN = "tok-gate-1";
const TOOL_CALL_ID = "toolu_write_1";

/** The live mobile resume shape: full history, decision stamped on the tail, real toolCallId. */
function resumeRequest(
  overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
  return {
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
    ...overrides,
  } as AgentRunRequest;
}

describe("extractInBandApprovalAnswers", () => {
  it("recovers the token and verdict from an approval envelope", () => {
    assert.deepEqual(extractInBandApprovalAnswers(resumeRequest()), [
      { token: TOKEN, approved: true, toolCallId: TOOL_CALL_ID },
    ]);
  });

  it("carries a deny through as approved:false, not as a dropped answer", () => {
    const request = resumeRequest();
    (request.messages as any)[2].content[0].output = {
      approved: false,
      interactionToken: TOKEN,
    };
    assert.deepEqual(extractInBandApprovalAnswers(request), [
      { token: TOKEN, approved: false, toolCallId: TOOL_CALL_ID },
    ]);
  });

  it("skips an envelope with no interactionToken — there is no row to key on", () => {
    const request = resumeRequest();
    (request.messages as any)[2].content[0].output = { approved: true };
    assert.deepEqual(extractInBandApprovalAnswers(request), []);
  });

  it("ignores a client-tool output — only approval envelopes carry a gate decision", () => {
    const request = resumeRequest();
    (request.messages as any)[2].content[0].output = "file written";
    assert.deepEqual(extractInBandApprovalAnswers(request), []);
  });

  it("deduplicates a token repeated across the history", () => {
    const request = resumeRequest();
    (request.messages as any).push((request.messages as any)[2]);
    assert.deepEqual(extractInBandApprovalAnswers(request), [
      { token: TOKEN, approved: true, toolCallId: TOOL_CALL_ID },
    ]);
  });

  it("collects one answer per gate when a parallel batch is answered together", () => {
    const request = resumeRequest();
    (request.messages as any)[2].content.push({
      type: "tool_result",
      toolCallId: "toolu_bash_2",
      toolName: "Bash",
      output: { approved: false, interactionToken: "tok-gate-2" },
    });
    assert.deepEqual(extractInBandApprovalAnswers(request), [
      { token: TOKEN, approved: true, toolCallId: TOOL_CALL_ID },
      { token: "tok-gate-2", approved: false, toolCallId: "toolu_bash_2" },
    ]);
  });

  it("scopes to the current turn: a prior turn's already-terminal row is not re-settled", () => {
    // A long session's history keeps every past envelope. Re-settling them on every turn would
    // fire a 404 transition per approval per turn; the row is already terminal.
    const request = resumeRequest();
    (request.messages as any).push({ role: "user", content: "now do something else" });
    assert.deepEqual(extractInBandApprovalAnswers(request), []);
  });

  it("returns nothing for a plain new turn", () => {
    const request = {
      messages: [{ role: "user", content: "hello" }],
    } as AgentRunRequest;
    assert.deepEqual(extractInBandApprovalAnswers(request), []);
  });

  it("returns nothing for an empty request", () => {
    assert.deepEqual(extractInBandApprovalAnswers({} as AgentRunRequest), []);
  });
});
