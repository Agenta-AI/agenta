import { describe, expect, it } from "vitest";
import { classifyRunError, MODEL_REQUEST_TIMED_OUT_MESSAGE } from "../../src/engines/sandbox_agent/errors.ts";

describe("a model call that timed out in the OpenAI client", () => {
  // The live-us turn of 2026-10-25: Pi waited 300 s twice and ended with this text, which the
  // classifier logged as an unclassified run error.
  it("reads as the model provider not answering, not as an unclassified error", () => {
    const raw = Object.assign(new Error("Internal error: Request timed out."), { code: -32603 });
    expect(classifyRunError(raw, "pi_core", "agenta", { unknownText: "hidden" })).toEqual({
      message: MODEL_REQUEST_TIMED_OUT_MESSAGE,
      code: "upstream_error",
    });
  });

  it("leaves a timeout worded another way to the other rules", () => {
    const raw = new Error("Internal error: the request timed out while reading the drive");
    expect(classifyRunError(raw, "pi_core", "agenta", { unknownText: "hidden" }).message).not.toBe(
      MODEL_REQUEST_TIMED_OUT_MESSAGE,
    );
  });
});
