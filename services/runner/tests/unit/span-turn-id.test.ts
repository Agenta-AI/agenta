import { describe, expect, it } from "vitest";

import { spanTurnId, type AgentRunRequest } from "../../src/protocol.ts";

const request = (fields: Partial<AgentRunRequest>): AgentRunRequest =>
  fields as AgentRunRequest;

describe("spanTurnId", () => {
  it("uses the execution id on a fresh session turn", () => {
    expect(spanTurnId(request({ sessionId: "sess-1", turnId: "turn-1" }))).toBe("turn-1");
  });

  it("uses the session turn id on an approval resume", () => {
    expect(
      spanTurnId(
        request({ sessionId: "sess-1", turnId: "execution-2", sessionTurnId: "turn-1" }),
      ),
    ).toBe("turn-1");
  });

  it("returns nothing for a run with no session, even when it has an execution id", () => {
    expect(spanTurnId(request({ turnId: "execution-1" }))).toBeUndefined();
    expect(spanTurnId(request({ sessionId: "  ", turnId: "execution-1" }))).toBeUndefined();
  });
});
