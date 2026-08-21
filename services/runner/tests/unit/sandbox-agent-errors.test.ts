/**
 * Unit tests for sandbox-agent user-facing error formatting.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-errors.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  classifyRunError,
  conciseError,
} from "../../src/engines/sandbox_agent/errors.ts";

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
      conciseError(
        new Error("Authentication required"),
        "pi_core",
        "anthropic",
      ),
      "pi_core: model authentication failed — add the project's Anthropic key to the project vault, or log in (OAuth).",
    );
  });

  it("names the resolved provider for a Pi+Anthropic credit failure", () => {
    assert.equal(
      conciseError(
        new Error("credit balance is too low"),
        "pi_core",
        "anthropic",
      ),
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
      conciseError(
        new Error("Authentication required"),
        "pi_core",
        "openai-codex",
      ),
      "pi_core: model authentication failed — add the project's OpenAI key to the project vault, or log in (OAuth).",
    );
  });

  it("formats a corrupt image provider error as a friendly message", () => {
    assert.equal(
      conciseError(
        new Error('400 invalid_request_error "Could not process image"'),
        "claude",
        "anthropic",
      ),
      "claude: the attached image appears to be corrupted or incomplete — try re-attaching it.",
    );
  });

  it("does not misclassify an unrelated invalid_request_error as an image error", () => {
    assert.equal(
      conciseError(
        new Error("invalid_request_error: missing required field 'model'"),
        "claude",
        "anthropic",
      ),
      "invalid_request_error: missing required field 'model'",
    );
  });

  it("falls back to the first line", () => {
    assert.equal(
      conciseError(new Error("first line\nsecond line"), "pi"),
      "first line",
    );
  });

  it("lets an auth-fault diagnosis replace the add-a-key line", () => {
    // A subscription run uses no vault key, so "add the project's OpenAI key" is the wrong advice
    // when the mounted login is what is broken (issue #5692).
    assert.equal(
      conciseError(new Error("401 unauthorized"), "codex", "openai", {
        authFault: () =>
          "codex: the mounted ChatGPT login is empty or unreadable.",
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
      conciseError(new Error("401 unauthorized"), "codex", "openai", {
        authFault,
      }),
      "codex: model authentication failed — add the project's OpenAI key to the project vault, or log in (OAuth).",
    );
    assert.equal(consulted, 1);

    assert.equal(
      conciseError(new Error("something else entirely"), "codex", "openai", {
        authFault,
      }),
      "something else entirely",
    );
    assert.equal(
      consulted,
      1,
      "the fault check is only run on the auth branch",
    );
  });
});

/**
 * Admission-time refusals from the budgeted model proxy in front of the funded starter credits.
 * Every body here is the shape LiteLLM actually returns; the assertions pin BOTH halves of the
 * classification, because the code is what a client renders a state from and the message is what
 * the user reads.
 */
describe("classifyRunError: budgeted-proxy refusals", () => {
  const KEY_BUDGET_BODY =
    'litellm.BudgetExceededError: Error code: 429 - {"error": {"message": "Budget has been exceeded! Key=sk-EXAMPLE-not-a-real-key Current cost: 5.0031, Max budget: 5.0", "type": "budget_exceeded", "code": "429"}}';
  const TEAM_BUDGET_BODY =
    'litellm.BudgetExceededError: Error code: 429 - {"error": {"message": "Budget has been exceeded! Team=starter-credits-program Current cost: 4998.22, Max budget: 5000.0", "type": "budget_exceeded", "code": "429"}}';
  const RATE_LIMIT_BODY =
    'Error code: 429 - {"error": {"message": "Max parallel request limit reached. Hit limit for api_key: 7f3c. active requests: 8.", "type": "rate_limit_error", "code": "429"}}';
  const NO_DB_BODY =
    'Error code: 503 - {"error": {"message": "Failed to connect to DB. Check logs.", "type": "no_db_connection", "code": "503"}}';
  const VERTEX_QUOTA_BODY =
    "Error code: 429 - RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Generate requests per minute' of service 'aiplatform.googleapis.com'.";

  it("maps a spent key budget to the starter-credits-exhausted state", () => {
    assert.deepEqual(
      classifyRunError(new Error(KEY_BUDGET_BODY), "claude", "anthropic"),
      {
        message:
          "This organization's starter credits are used up. Add your own provider key to keep going.",
        code: "starter_credits_exhausted",
      },
    );
  });

  it("maps a team/program budget to the program-paused state, not the per-organization one", () => {
    // Same status, same `budget_exceeded` type: only the named subject separates "you are out of
    // credits" from "the whole program is out", and they call for different advice.
    assert.deepEqual(
      classifyRunError(new Error(TEAM_BUDGET_BODY), "pi_core", "gemini"),
      {
        message:
          "The free starter credits program is paused right now. Add your own provider key to continue.",
        code: "starter_credits_program_paused",
      },
    );
  });

  it("maps a proxy rate limit to a retry, never to exhaustion", () => {
    assert.deepEqual(classifyRunError(new Error(RATE_LIMIT_BODY), "claude"), {
      message: "Too many requests right now. Try again in a moment.",
      code: "rate_limited",
    });
  });

  it("maps a proxy database outage to the service-unavailable state", () => {
    assert.deepEqual(classifyRunError(new Error(NO_DB_BODY), "claude"), {
      message:
        "The starter credits service is temporarily unavailable. Try again in a moment.",
      code: "starter_credits_unavailable",
    });
  });

  it("maps a refused connection to the proxy to the service-unavailable state", () => {
    assert.deepEqual(
      classifyRunError(
        new Error(
          "APIConnectionError: connect ECONNREFUSED — litellm proxy did not answer",
        ),
        "pi_core",
      ),
      {
        message:
          "The starter credits service is temporarily unavailable. Try again in a moment.",
        code: "starter_credits_unavailable",
      },
    );
  });

  it("does not read an unattributed connection failure as a credits outage", () => {
    // A bare ECONNREFUSED could be any host the run touched (an MCP server, a tool endpoint).
    assert.equal(
      classifyRunError(
        new Error("connect ECONNREFUSED 10.0.0.4:8931"),
        "claude",
      ).code,
      "runner_error",
    );
  });

  it("maps an upstream provider quota refusal to a retry, named for the provider", () => {
    assert.deepEqual(
      classifyRunError(new Error(VERTEX_QUOTA_BODY), "pi_core", "gemini"),
      {
        message:
          "Too many requests to the model provider right now. Try again in a moment.",
        code: "rate_limited",
      },
    );
  });

  it("does not map an unrelated 429 to exhaustion", () => {
    // The whole point of matching on the body: 429 alone means nothing here.
    const unrelated = classifyRunError(
      new Error(
        'Error code: 429 - {"error": {"message": "Upstream service is busy, retry later", "type": "server_error", "code": "429"}}',
      ),
      "claude",
    );
    assert.notEqual(unrelated.code, "starter_credits_exhausted");
    assert.notEqual(unrelated.code, "starter_credits_program_paused");
    assert.equal(unrelated.code, "runner_error");
  });

  it("keeps an unpaid provider account on the billing line, not the throttling one", () => {
    // OpenAI raises insufficient_quota as a RateLimitError; it is a billing stop, and telling the
    // operator to "try again in a moment" would send them into a loop.
    const classified = classifyRunError(
      new Error(
        'RateLimitError: Error code: 429 - {"error": {"message": "You exceeded your current quota, please check your plan and billing details.", "type": "insufficient_quota"}}',
      ),
      "pi_core",
      "openai",
    );
    assert.equal(classified.code, "runner_error");
    assert.equal(
      classified.message,
      "pi_core: the model provider account has insufficient credit (check the project's OpenAI key).",
    );
  });

  it("never leaks key material, spend figures, or the raw body into the user-visible line", () => {
    for (const body of [
      KEY_BUDGET_BODY,
      TEAM_BUDGET_BODY,
      RATE_LIMIT_BODY,
      NO_DB_BODY,
    ]) {
      const { message } = classifyRunError(
        new Error(body),
        "claude",
        "anthropic",
      );
      for (const secret of [
        "sk-EXAMPLE-not-a-real-key",
        "EXAMPLE-not-a-real-key",
        "7f3c",
        "Key=",
        "api_key",
        "Max budget",
        "Current cost",
        "budget_exceeded",
        "litellm",
        "429",
        "503",
      ]) {
        assert.equal(
          message.includes(secret),
          false,
          `"${secret}" leaked into: ${message}`,
        );
      }
    }
  });

  it("leaves every unclassified failure on the default code", () => {
    assert.deepEqual(classifyRunError(new Error("first line\nsecond"), "pi"), {
      message: "first line",
      code: "runner_error",
    });
  });

  it("keeps conciseError as the message half of the same classification", () => {
    assert.equal(
      conciseError(new Error(KEY_BUDGET_BODY), "claude", "anthropic"),
      classifyRunError(new Error(KEY_BUDGET_BODY), "claude", "anthropic")
        .message,
    );
  });
});
