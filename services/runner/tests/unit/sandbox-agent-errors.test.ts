/**
 * Unit tests for sandbox-agent user-facing error formatting.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-errors.test.ts)
 */
import { describe, expect, it } from "vitest";
import assert from "node:assert/strict";

import {
  abandonedTurnMessage,
  classifyRunError,
  conciseError,
  REQUEST_TOO_LARGE_MESSAGE,
  RUNNER_RESTARTING_MESSAGE,
  RUNNER_SHUTDOWN_REASON,
  SANDBOX_CAPACITY_MESSAGE,
  sanitizeErrorText,
  withPublicCode,
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

  it("formats OpenRouter's 402 insufficient credits as insufficient credit", () => {
    assert.equal(
      conciseError(
        new Error(
          'Internal error: 402 {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402}}',
        ),
        "pi_core",
        "openrouter",
      ),
      "pi_core: the model provider account has insufficient credit (check the project's OpenRouter key).",
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

  it("names xAI for a failed Grok run instead of the OpenAI fallback", () => {
    assert.equal(
      conciseError(new Error("401 unauthorized"), "pi_core", "xai"),
      "pi_core: model authentication failed — add the project's xAI key to the project vault, or log in (OAuth).",
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

  it("classifies an unsubstituted Daytona placeholder as credential delivery, not the user's key", () => {
    // The LiteLLM refusal body when the sandbox's opaque placeholder reaches it raw: the user's
    // key is fine, so the add-a-key advice would be wrong (found live, 2026-08-29, EU cloud).
    const result = classifyRunError(
      new Error(
        "401 LiteLLM Virtual Key expected. Received=dtn_****9maz, expected to start with 'sk-'.",
      ),
      "pi_core",
      "openai",
    );
    assert.equal(result.code, "credential_delivery_failed");
    assert.equal(
      result.message,
      "A temporary issue kept this run's credentials from reaching the model. Send the message again.",
    );
  });

  it("classifies a raw dtn_secret_ placeholder echo the same way", () => {
    const result = classifyRunError(
      new Error("401 Unauthorized: invalid api key 'dtn_secret_abc123'"),
      "pi_core",
      "openai",
    );
    assert.equal(result.code, "credential_delivery_failed");
  });

  it("names the connection neutrally, not the dialect family, for a custom-deployment auth failure", () => {
    // A custom OpenAI-compatible connection resolves provider family "openai" for its DIALECT.
    // A Gemini run through such a connection must not read "add the project's OpenAI key".
    // And the hint must not name the SLUG: the runner cannot tell a user-created connection
    // from a managed hidden one (starter-credits), so a slug can be an internal identifier
    // pointing at a connection the user cannot edit (review finding on #6362).
    const line = conciseError(
      new Error("Authentication required"),
      "pi_core",
      "openai",
      {
        connection: { slug: "starter-credits", deployment: "custom" },
      },
    );
    assert.equal(
      line,
      "pi_core: model authentication failed — add the model connection's API key to the project vault, or log in (OAuth).",
    );
    assert.doesNotMatch(line, /starter-credits/);
  });

  it("keeps the family hint when the deployment is not custom", () => {
    assert.equal(
      conciseError(new Error("Authentication required"), "pi_core", "openai", {
        connection: { slug: "openai", deployment: "direct" },
      }),
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
          "Your free Agenta credits are used up. Add your own provider key to keep going.",
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
          "Free Agenta credits are paused right now. Add your own provider key to continue.",
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
        "Agenta credits are temporarily unavailable. Try again in a moment.",
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
          "Agenta credits are temporarily unavailable. Try again in a moment.",
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

  /**
   * The exact frame a spent funded key produced on the dev stack, verbatim from live QA: the
   * status is prefixed onto a bare (not `{"error": {...}}`-wrapped) body, `Key=` is the
   * organization UUID that aliases the key, and the parenthesized token is the key's suffix.
   * Both identify the key and neither may reach the user.
   */
  const LIVE_KEY_BUDGET_BODY =
    '429: {"message":"Budget has been exceeded! Key=01a02587-2bb7-72b3-bb3d-295ad563d116 (sk-...3kKQ) Current cost: 0.001690500000000003, Max budget: 1e-07","type":"budget_exceeded","code":"429"}';

  it("maps the live refusal observed on the dev stack to the exhausted state", () => {
    assert.deepEqual(
      classifyRunError(new Error(LIVE_KEY_BUDGET_BODY), "pi_core", "gemini"),
      {
        message:
          "Your free Agenta credits are used up. Add your own provider key to keep going.",
        code: "starter_credits_exhausted",
      },
    );
  });

  it("hides the key alias, the key suffix, and the spend figures of the live refusal", () => {
    const { message } = classifyRunError(
      new Error(LIVE_KEY_BUDGET_BODY),
      "pi_core",
      "gemini",
    );
    for (const identifier of [
      "01a02587-2bb7-72b3-bb3d-295ad563d116",
      "01a02587",
      "sk-...3kKQ",
      "3kKQ",
      "0.001690500000000003",
      "1e-07",
      "Key=",
      "budget_exceeded",
      "429",
    ]) {
      assert.equal(
        message.includes(identifier),
        false,
        `"${identifier}" leaked into: ${message}`,
      );
    }
  });

  it("classifies the refusal even when the harness's retry notice comes first", () => {
    // The Pi harness treats this 429 as retryable and streams "Retrying (attempt 1/3, waiting
    // 2s)..." before the failure surfaces. Classification reads the WHOLE error, not just its
    // first line, so that chatter cannot displace the mapped message — the first-line fallback
    // is only ever reached by an unclassified error.
    assert.deepEqual(
      classifyRunError(
        new Error(
          `Retrying (attempt 1/3, waiting 2s)...\n${LIVE_KEY_BUDGET_BODY}`,
        ),
        "pi_core",
        "gemini",
      ),
      {
        message:
          "Your free Agenta credits are used up. Add your own provider key to keep going.",
        code: "starter_credits_exhausted",
      },
    );
  });

  it("does not classify the retry notice on its own", () => {
    // The notice is ordinary harness text; only a refusal body may drive a state.
    assert.deepEqual(
      classifyRunError(
        new Error("Retrying (attempt 1/3, waiting 2s)..."),
        "pi_core",
      ),
      {
        message: "Retrying (attempt 1/3, waiting 2s)...",
        code: "runner_error",
      },
    );
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

describe("provider errors never reach the chat raw (QA R3W-5)", () => {
  const groq413 =
    'Internal error: 413 {"error":{"message":"Request too large for model `openai/gpt-oss-120b` in organization `org_01abcdef` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 15661. Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}';

  it("reads a request-too-large refusal as that, not as a rate limit", () => {
    const classified = classifyRunError(new Error(groq413), "pi_core", "groq");
    assert.equal(classified.message, REQUEST_TOO_LARGE_MESSAGE);
    assert.ok(!classified.message.includes("org_"));
  });

  it("shows a raw provider body's reason, not the body", () => {
    const classified = classifyRunError(
      new Error('Internal error: 400 {"error":{"message":"bad thing in organization org_9","type":"invalid_request_error"}}'),
      "pi_core",
    );
    assert.equal(classified.code, "provider_error");
    assert.match(classified.message, /^The model provider refused the request \(HTTP 400\): bad thing in organization org_9\. You can keep going/);
    assert.doesNotMatch(classified.message, /invalid_request_error|\{/);
  });

  it("reads OpenAI's own `API error (NNN): {json}` form the same way, even when unknown text is hidden", () => {
    // Pi's OpenAI provider reports a refusal as `OpenAI API error (404): {...}`. `inprocess` hides
    // text it cannot classify behind a reference, so this form must be classified (staging, 2026-09-25).
    const raw =
      'OpenAI API error (404): {"message":"The model `totally-not-a-real-model-v99` does not exist or you do not have access to it.","type":"invalid_request_error","param":null,"code":"model_not_found"}';
    const classified = classifyRunError(new Error(raw), "pi_core", "openai", { unknownText: "hidden" });
    assert.equal(classified.code, "provider_error");
    assert.match(classified.message, /^The model provider refused the request \(HTTP 404\): The model `totally-not-a-real-model-v99` does not exist/);
    assert.doesNotMatch(classified.message, /model_not_found|\{|reference/);
  });

  it("reads a provider refusal that pi-acp wrapped as `Internal error: ...` (ST-IP-1)", () => {
    // `inprocess` gets Pi's failure from pi-acp as ACP `RequestError.internalError`, whose message
    // prefixes "Internal error: ". OpenAI's form then carries two labels before its status.
    const openai =
      'Internal error: OpenAI API error (404): {"message":"The model `totally-not-a-real-model-v99` does not exist or you do not have access to it.","type":"invalid_request_error","param":null,"code":"model_not_found"}';
    const classified = classifyRunError(new Error(openai), "pi_core", "openai", { unknownText: "hidden" });
    assert.equal(classified.code, "provider_error");
    assert.match(classified.message, /^The model provider refused the request \(HTTP 404\): The model `totally-not-a-real-model-v99` does not exist/);
    assert.doesNotMatch(classified.message, /model_not_found|\{|reference|Internal error/);
    // Groq's form (no provider label) already read as a refusal; it must keep doing so.
    const groq = classifyRunError(
      new Error('Internal error: 404: {"message":"The model `nope` does not exist.","code":"model_not_found"}'),
      "pi_core",
      "groq",
      { unknownText: "hidden" },
    );
    assert.equal(groq.code, "provider_error");
    assert.match(groq.message, /^The model provider refused the request \(HTTP 404\): The model `nope` does not exist\./);
  });

  it("classifies a long line of labels without backtracking", () => {
    const started = Date.now();
    classifyRunError(new Error("a:   ".repeat(5000) + "x"), "pi_core", "openai", { unknownText: "hidden" });
    assert.ok(Date.now() - started < 1000);
  });

  it("leaves the runner's own readable sentences alone", () => {
    const classified = classifyRunError(new Error("The drive is not mounted on the runner right now, so the command did not run."), "pi_core");
    assert.equal(classified.message, "The drive is not mounted on the runner right now, so the command did not run.");
  });
});

describe("a turn the runner had to end (QA3A-4)", () => {
  it("tells the person to resend when a restart ended it", () => {
    const message = abandonedTurnMessage(RUNNER_SHUTDOWN_REASON, "pi");
    assert.equal(message, RUNNER_RESTARTING_MESSAGE);
    assert.doesNotMatch(message, /execution abandoned/);
  });

  it("reads as a lost run otherwise", () => {
    assert.match(abandonedTurnMessage("the run did not unwind", "pi"), /Send the message again/);
  });
});

describe("the public error contract (Codex R4 P1, decision 10)", () => {
  it("redacts credentials from an unclassified error and keeps the rest of the sentence", () => {
    expect(sanitizeErrorText("provider failed: org-private123 sandbox sbx-123 at /home/sandbox/agenta/session")).toBe(
      "provider failed: org-private123 sandbox sbx-123 at /home/sandbox/agenta/session",
    );
    expect(sanitizeErrorText("test-reached-sandbox-start")).toBe("test-reached-sandbox-start");
    expect(sanitizeErrorText('upstream said {"error":{"message":"bad","api_key":"abc-123"}}')).toBe(
      'upstream said {"error":{"message":"bad",api_key=[secret]}}',
    );
    expect(sanitizeErrorText("see https://example.com/a/b and src/main.py")).toBe("see https://example.com/a/b and src/main.py");
    expect(sanitizeErrorText("The agent service restarted, so this turn was ended. Send the message again in a moment.")).toBe(
      "The agent service restarted, so this turn was ended. Send the message again in a moment.",
    );
  });

  it("sanitizes the fallback of classifyRunError, which used to return raw text", () => {
    expect(classifyRunError(new Error("provider failed at /home/sandbox/agenta/session with token=abc123"), "pi").message).toBe(
      "provider failed at /home/sandbox/agenta/session with token=[secret]",
    );
  });

  it("passes an error that states its public code through, and maps a sandbox provider's quota refusal", () => {
    const err = withPublicCode(new Error("This agent service is at capacity right now. Send the message again in a moment."), "runner_capacity");
    expect(classifyRunError(err, "pi")).toEqual({ message: err.message, code: "runner_capacity" });
    const quota = new Error(
      "Total disk limit exceeded. Maximum allowed: 300GiB.\nConsider archiving your unused Sandboxes to free up available storage.\nTo increase concurrency limits, upgrade your organization's Tier by visiting https://app.daytona.io/dashboard/limits.",
    );
    expect(classifyRunError(quota, "pi")).toEqual({ message: SANDBOX_CAPACITY_MESSAGE, code: "sandbox_capacity" });
  });
});

describe("the public error contract, round 5 (Codex R5 P1-5)", () => {
  it("redacts credentials however they are written", () => {
    expect(sanitizeErrorText("upstream answered 401 for Authorization: Bearer abcDEF123.ghi-jkl_456")).toBe(
      "upstream answered 401 for Authorization: Bearer [secret]",
    );
    expect(sanitizeErrorText("call failed with api_key=abc123def and token: xyz789")).toBe("call failed with api_key=[secret] and token=[secret]");
    expect(sanitizeErrorText("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig rejected")).toBe("jwt [secret] rejected");
    expect(sanitizeErrorText("see https://example.com/a/b for openai/gpt-4o-mini-2024-07-18")).toBe("see https://example.com/a/b for openai/gpt-4o-mini-2024-07-18");
  });

  it("shows one generic sentence with a reference for an error no rule recognizes, on inprocess", () => {
    const raw = new Error("Internal error: ENOENT: no such file or directory, open '/home/sandbox/agenta/mounts/p/s/agents/sessions/pi/x.jsonl' (Bearer abcdef123456)");
    const classified = classifyRunError(raw, "pi_core", undefined, { unknownText: "hidden" });
    // Its own class, so a client knows the text was withheld and shows nothing else in its place (Codex R6 P1-5).
    expect(classified.code).toBe("internal_error");
    expect(classified.message).toMatch(/^The agent run failed \(reference [0-9a-f]{8}\)\. Send the message again/);
    expect(classified.message).not.toMatch(/ENOENT|home|Bearer|abcdef/);
  });

  it("keeps the redacted first line for local and daytona, whose own sentences carry no public code yet", () => {
    expect(classifyRunError(new Error("ENOENT:/home/tenant/file"), "pi").message).toBe("ENOENT:/home/tenant/file");
  });
});


describe("the public error contract, round 6 (Codex R6 P1-5)", () => {
  it("redacts quoted credentials, however they are quoted, and leaves ordinary text alone", () => {
    expect(sanitizeErrorText("upstream failed: password='hunter-value'")).toBe("upstream failed: password=[secret]");
    expect(sanitizeErrorText('upstream failed: token="sensitive-value"')).toBe("upstream failed: token=[secret]");
    expect(sanitizeErrorText("login failed: password='two words'")).toBe("login failed: password=[secret]");
    expect(sanitizeErrorText("config {'api_key': 'abc def ghi'} rejected")).toBe("config {api_key=[secret]} rejected");
    expect(sanitizeErrorText("headers x-api-key: `abcdef` and secret=`s3cr3t`")).toBe("headers x-api-key=[secret] and secret=[secret]");
    expect(sanitizeErrorText("cut off: password='hunter")).toBe("cut off: password=[secret]");
    expect(sanitizeErrorText("the key is missing; see https://example.com/a for openai/gpt-4o")).toBe(
      "the key is missing; see https://example.com/a for openai/gpt-4o",
    );
  });
});

describe("a model the in-process runtime does not know (Codex R6: terminal configuration failures)", () => {
  it("reads as a setting to change, with its own class, not as 'send it again'", async () => {
    const { modelUnavailableError } = await import("../../src/engines/inprocess/pi/acp-session.ts");
    const classified = classifyRunError(modelUnavailableError("groq/no-such-model"), "pi_core", undefined, { unknownText: "hidden" });
    expect(classified).toEqual({
      code: "model_unavailable",
      message: "The model 'groq/no-such-model' is not available to this agent. Pick another model in the agent's settings.",
    });
  });
});

describe("a provider's own error (provider_error)", () => {
  // The exact text of POC references f14267d0, 19d7af41 and 11f43cc6: Inception's guardrail,
  // returned by OpenRouter as an error instead of an answer.
  const INCEPTION =
    "Internal error: Upstream error from Inception: I'm sorry, but I can't share details of my architecture or training process. Would you like to learn about how language models work in general instead?";

  it.each(["hidden", "sanitized"] as const)("reads the provider's sentence with unknown text %s instead of a reference", (unknownText) => {
    const classified = classifyRunError(new Error(INCEPTION), "pi_core", "openrouter", { unknownText });
    expect(classified.code).toBe("provider_error");
    expect(classified.message).toContain("The model provider (Inception) returned an error: I'm sorry, but I can't share details of my architecture or training process.");
    expect(classified.message).toContain("You can keep going in this conversation");
    expect(classified.message).not.toMatch(/reference|Send the message again|Internal error/);
  });

  it("redacts what the provider said", () => {
    const classified = classifyRunError(
      new Error("Upstream error from Acme: key=sk-abcdefghijklmnop rejected, Authorization: Bearer abcdef123456"),
      "pi_core",
      "openrouter",
      { unknownText: "hidden" },
    );
    expect(classified.code).toBe("provider_error");
    expect(classified.message).not.toContain("sk-abcdefghijklmnop");
    expect(classified.message).not.toContain("abcdef123456");
  });

  it("keeps the more specific classes for what they name", () => {
    expect(classifyRunError(new Error("Upstream error from Groq: rate limit reached"), "pi_core").code).toBe("rate_limited");
    expect(classifyRunError(new Error("Upstream error from X: request too large"), "pi_core").message).toBe(REQUEST_TOO_LARGE_MESSAGE);
  });

  it("names a content filter", () => {
    const classified = classifyRunError(new Error("400 The response was filtered due to content_filter"), "pi_core", undefined, { unknownText: "hidden" });
    expect(classified.code).toBe("provider_error");
    expect(classified.message).toContain("content filter");
  });
});

describe("flag-safety round: shared error rules match only what they name", () => {
  it("reads a 413 only as an HTTP status, never inside an id or a duration", () => {
    const auth = classifyRunError(new Error("401 Unauthorized: invalid x-api-key (request_id: req_ab413cd9)"), "claude", "anthropic");
    expect(auth.message).toMatch(/model authentication failed/);
    expect(classifyRunError(new Error("Stream idle timeout after 413s"), "pi_core").message).not.toBe(REQUEST_TOO_LARGE_MESSAGE);
    expect(classifyRunError(new Error("insufficient_quota for run 20241413"), "pi_core", "openai").message).toMatch(/insufficient credit/);
    expect(classifyRunError(new Error("413 Payload Too Large"), "pi_core").message).toBe(REQUEST_TOO_LARGE_MESSAGE);
    expect(classifyRunError(new Error("upstream answered HTTP 413"), "pi_core").message).toBe(REQUEST_TOO_LARGE_MESSAGE);
    expect(classifyRunError(new Error("request failed with status code 413"), "pi_core").message).toBe(REQUEST_TOO_LARGE_MESSAGE);
  });

  it("redacts credentials only: numbers, ids and paths stay", () => {
    expect(sanitizeErrorText("max_tokens: 4096 exceeds model limit")).toBe("max_tokens: 4096 exceeds model limit");
    expect(sanitizeErrorText("sandbox delete failed sandbox=3f2a1b4c-9d8e-4f7a-b6c5-d4e3f2a1b0c9")).toBe(
      "sandbox delete failed sandbox=3f2a1b4c-9d8e-4f7a-b6c5-d4e3f2a1b0c9",
    );
    expect(sanitizeErrorText("ENOENT: no such file or directory, open '/home/sandbox/project/app.py'")).toBe(
      "ENOENT: no such file or directory, open '/home/sandbox/project/app.py'",
    );
    expect(sanitizeErrorText("input_tokens=12000 prompt_tokens: 900")).toBe("input_tokens=12000 prompt_tokens: 900");
    expect(sanitizeErrorText("OPENAI_API_KEY=abcdef123 and Authorization: Bearer abcDEF123.ghi")).toBe(
      "OPENAI_API_KEY=[secret] and Authorization: Bearer [secret]",
    );
    expect(sanitizeErrorText("refresh_token: r1-xyz access_token=a1b2 password=hunter2")).toBe(
      "refresh_token=[secret] access_token=[secret] password=[secret]",
    );
    expect(sanitizeErrorText("provider key sk-abcdefghijklmnop rejected")).toBe("provider key [secret] rejected");
  });

  it("redacts a credential whose value is all digits or all letters, and plural key fields (Codex round 8)", () => {
    expect(sanitizeErrorText("password=123456 rejected")).toBe("password=[secret] rejected");
    expect(sanitizeErrorText("token=123456 rejected")).toBe("token=[secret] rejected");
    expect(sanitizeErrorText("Authorization: Token abcdefghijklmnop")).toBe("Authorization: Token [secret]");
    expect(sanitizeErrorText("api_keys=abcdefghijk rejected")).toBe("api_keys=[secret] rejected");
    expect(sanitizeErrorText("max_tokens: 4096 and input_tokens=12000 stay")).toBe("max_tokens: 4096 and input_tokens=12000 stay");
    expect(sanitizeErrorText("Token verification failed")).toBe("Token verification failed");
  });

  it("redacts any Authorization scheme in a quoted JSON header (Codex R9-3)", () => {
    expect(sanitizeErrorText('{"Authorization": "Token abcdefghijklmnop"}')).toBe('{"Authorization": "Token [secret]"}');
    expect(sanitizeErrorText("{'authorization': 'Digest abcdefghijklmnop'}")).toBe("{'authorization': 'Digest [secret]'}");
    expect(sanitizeErrorText('{"Authorization":"Bearer abcdefghijklmnop"}')).toBe('{"Authorization":"Bearer [secret]"}');
  });

  it("keeps a raw provider body's own reason, redacted", () => {
    const classified = classifyRunError(
      new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"messages: text content blocks must be non-empty"}}'),
      "claude",
      "anthropic",
    );
    expect(classified.code).toBe("provider_error");
    expect(classified.message).toContain("HTTP 400");
    expect(classified.message).toContain("messages: text content blocks must be non-empty");
    const withKey = classifyRunError(
      new Error('Internal error: 400 {"error":{"message":"bad request for api_key=abc123def","type":"invalid_request_error"}}'),
      "pi_core",
    );
    expect(withKey.message).toContain("api_key=[secret]");
    expect(withKey.message).not.toContain("abc123def");
  });
});
