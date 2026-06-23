/**
 * Unit tests for sandbox-agent user-facing error formatting.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-errors.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { conciseError } from "../../src/engines/sandbox_agent/errors.ts";

describe("conciseError", () => {
  it("formats provider credit failures with the right provider hint", () => {
    assert.equal(
      conciseError(new Error("credit balance is too low\nstack"), "claude"),
      "claude: the model provider account has insufficient credit (check the project's Anthropic key).",
    );
  });

  it("formats auth failures with the right provider hint", () => {
    assert.equal(
      conciseError(new Error("Authentication required"), "pi"),
      "pi: model authentication failed — add the project's OpenAI key to the project vault, or log in (OAuth).",
    );
  });

  it("falls back to the first line", () => {
    assert.equal(conciseError(new Error("first line\nsecond line"), "pi"), "first line");
  });
});
