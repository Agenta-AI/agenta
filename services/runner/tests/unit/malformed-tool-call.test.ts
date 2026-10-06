import { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { classifyRunError } from "../../src/engines/sandbox_agent/errors.ts";
import { classifyRunError as classify, MALFORMED_TOOL_CALL_MESSAGE } from "../../src/engines/sandbox_agent/errors.ts";
import { malformedToolCallError, MALFORMED_TOOL_CALL_TWICE_MESSAGE } from "../../src/engines/inprocess/pi/malformed-tool-call.ts";

describe("the malformed tool call retry", () => {
  // The retry widens Pi's own retry check; a Pi upgrade that renames it must fail here, not
  // silently turn the retry off in production.
  it("finds the retry check it widens on the installed Pi", () => {
    expect(typeof (AgentSession.prototype as unknown as Record<string, unknown>)._isRetryableError).toBe("function");
  });

  it("turns the second failure into the public error, and leaves any other error alone", () => {
    const raw = Object.assign(new Error("Internal error: Provider finish_reason: malformed_function_call"), { code: -32603 });
    expect(classifyRunError(malformedToolCallError(raw, true)!, "pi_core", "google", { unknownText: "hidden" })).toEqual({
      message: MALFORMED_TOOL_CALL_TWICE_MESSAGE,
      code: "malformed_tool_call",
    });
    expect(malformedToolCallError(new Error("Internal error: Provider finish_reason: content_filter"), true)).toBeUndefined();
  });

  // Pi's retry budget is shared: earlier transient failures can use it up before this one.
  it("does not say twice when the turn ended without the retry", () => {
    const raw = new Error("Internal error: Provider finish_reason: malformed_function_call");
    expect(classify(malformedToolCallError(raw, false)!, "pi_core", "google")).toEqual({
      message: MALFORMED_TOOL_CALL_MESSAGE,
      code: "malformed_tool_call",
    });
  });
});
