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

  it("formats OpenAI quota failures as insufficient credit", () => {
    assert.equal(
      conciseError(
        new Error(
          "You exceeded your current quota, please check your plan and billing details.",
        ),
        "pi",
      ),
      "pi: the model provider account has insufficient credit (check the project's OpenAI key).",
    );
  });

  it("formats auth failures with the right provider hint", () => {
    assert.equal(
      conciseError(new Error("Authentication required"), "pi"),
      "pi: model authentication failed — add the project's OpenAI key to the project vault, or log in (OAuth).",
    );
  });

  it("names the resolved provider, not the harness, for a Pi+Anthropic run", () => {
    // The bug: a Pi run against an Anthropic model that fails auth must NOT say "OpenAI key".
    assert.equal(
      conciseError(new Error("Authentication required"), "pi_core", "anthropic"),
      "pi_core: model authentication failed — add the project's Anthropic key to the project vault, or log in (OAuth).",
    );
  });

  it("names the resolved provider for a Pi+Anthropic credit failure", () => {
    assert.equal(
      conciseError(new Error("credit balance is too low"), "pi_core", "anthropic"),
      "pi_core: the model provider account has insufficient credit (check the project's Anthropic key).",
    );
  });

  it("keeps the OpenAI hint when the resolved provider is openai on Pi", () => {
    assert.equal(
      conciseError(new Error("insufficient_quota"), "pi_core", "openai"),
      "pi_core: the model provider account has insufficient credit (check the project's OpenAI key).",
    );
  });

  it("falls back to the harness default when no provider is resolved", () => {
    // Un-migrated caller (no provider on the wire): keep the old harness-derived behavior.
    assert.equal(
      conciseError(new Error("401 unauthorized"), "claude"),
      "claude: model authentication failed — add the project's Anthropic key to the project vault, or log in (OAuth).",
    );
    assert.equal(
      conciseError(new Error("401 unauthorized"), "pi_core"),
      "pi_core: model authentication failed — add the project's OpenAI key to the project vault, or log in (OAuth).",
    );
  });

  it("falls back to the harness default for an unknown custom provider", () => {
    // A custom router slug we have no key label for: do not invent one, use the harness default.
    assert.equal(
      conciseError(new Error("Authentication required"), "pi_core", "openai-codex"),
      "pi_core: model authentication failed — add the project's OpenAI key to the project vault, or log in (OAuth).",
    );
  });

  it("falls back to the first line", () => {
    assert.equal(conciseError(new Error("first line\nsecond line"), "pi"), "first line");
  });

  it("lets an auth-fault diagnosis replace the add-a-key line", () => {
    // A subscription run uses no vault key, so "add the project's OpenAI key" is the wrong advice
    // when the mounted login is what is broken (issue #5692).
    assert.equal(
      conciseError(new Error("401 unauthorized"), "codex", "openai", {
        authFault: () => "codex: the mounted ChatGPT login is empty or unreadable.",
      }),
      "codex: the mounted ChatGPT login is empty or unreadable.",
    );
  });

  it("keeps the generic auth line when the fault check finds nothing, and never consults it otherwise", () => {
    let consulted = 0;
    const authFault = () => {
      consulted += 1;
      return undefined;
    };
    assert.equal(
      conciseError(new Error("401 unauthorized"), "codex", "openai", { authFault }),
      "codex: model authentication failed — add the project's OpenAI key to the project vault, or log in (OAuth).",
    );
    assert.equal(consulted, 1);

    assert.equal(
      conciseError(new Error("something else entirely"), "codex", "openai", { authFault }),
      "something else entirely",
    );
    assert.equal(consulted, 1, "the fault check is only run on the auth branch");
  });
});
