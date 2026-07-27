import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { claudeThinkingMeta } from "../../src/engines/sandbox_agent/claude-thinking.ts";

describe("claudeThinkingMeta", () => {
  it("requests visible ('summarized') adaptive thinking under _meta.claudeCode.options", () => {
    // Recent Claude models default `display` to "omitted" (signature-only, empty text), so no
    // agent_thought_chunk is emitted and the playground shows no reasoning. This meta flips the
    // display to "summarized" so reasoning surfaces, while `adaptive` leaves the think-or-not
    // decision to the model.
    assert.deepEqual(claudeThinkingMeta(), {
      claudeCode: {
        options: { thinking: { type: "adaptive", display: "summarized" } },
      },
    });
  });
});
