/**
 * The tracer remembers which tool calls `settleOpenToolCalls` closed.
 *
 * When one call pauses the turn, the runner closes every other open call as not executed. A
 * sibling's gate can arrive a moment later, and the park seams ask `wasForceSettled` so they do
 * not park a call the transcript already closed.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

describe("wasForceSettled", () => {
  it("is true only for the calls settleOpenToolCalls closed", () => {
    const run = createSandboxAgentOtel({
      harness: "claude",
      model: "anthropic/x",
      emit: () => {},
    });
    run.start({ prompt: "hi" });
    for (const toolCallId of ["parked", "sibling"]) {
      run.handleUpdate({
        sessionUpdate: "tool_call",
        toolCallId,
        title: "request_connection",
        rawInput: {},
      });
    }

    run.settleOpenToolCalls((id) => id === "parked", "DEFERRED_NOT_EXECUTED");

    assert.equal(run.wasForceSettled("sibling"), true);
    assert.equal(run.wasForceSettled("parked"), false);
    assert.equal(run.wasForceSettled("never-seen"), false);
  });
});
