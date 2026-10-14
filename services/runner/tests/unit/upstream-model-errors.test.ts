/**
 * A model call that failed at the endpoint behind the gateway: the gateway writes the sentence and
 * marks it `upstream_error` or `upstream_rejected` (`api/oss/src/core/gateways/llms/errors.py`),
 * and the runner shows that sentence instead of hiding it behind a reference.
 *
 * The harness texts below are what Pi 0.99.1 and pi-acp report for each gateway shape.
 *
 * Run: pnpm exec vitest run tests/unit/upstream-model-errors.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { isRetryableAssistantError } from "pi-coding-agent-pi-ai";

import { parseGatewayErrorDetail } from "../../src/gateway-error.ts";
import { classifyRunError } from "../../src/engines/sandbox_agent/errors.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { AgentEvent } from "../../src/protocol.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";

const INCIDENT_SENTENCE =
  'The model reported an error: "Upstream request failed". Try again.';
// An SSE error frame after HTTP 200: Pi keeps the frame's message, pi-acp prefixes it.
const INCIDENT =
  `Internal error: ${INCIDENT_SENTENCE} ⟦agenta_code:upstream_error⟧`;

const CREDITS_SENTENCE =
  'The model reported an error: "You have no credits remaining". ' +
  "Check the endpoint's key, account and model, or change the request.";
// An HTTP 402: Pi reports `<status>: <the unwrapped error object>`, provider fields kept.
const CREDITS =
  "Internal error: 402: " +
  JSON.stringify({
    message: `${CREDITS_SENTENCE} ⟦agenta_code:upstream_rejected⟧`,
    type: "insufficient_quota",
    code: "insufficient_quota",
  });

const CONNECTION_LOST_SENTENCE =
  'The model stopped before the answer finished (connection error). Try again.';
// A Responses stream the gateway closed with an `error` event; Pi prefixes the event's code.
const CONNECTION_LOST =
  `Internal error: Error Code upstream_error: ${CONNECTION_LOST_SENTENCE} ` +
  "⟦agenta_code:upstream_error⟧";

const MALFORMED = "Internal error: Provider finish_reason: malformed_function_call";

describe("the gateway's upstream sentence is recovered whole", () => {
  it("reads the marker-only text, retryable, without the harness wrapper", () => {
    assert.deepEqual(parseGatewayErrorDetail(INCIDENT), {
      code: "upstream_error",
      message: INCIDENT_SENTENCE,
      retryable: true,
    });
  });

  it("takes the marker's code over the provider's own, on the body path", () => {
    const detail = parseGatewayErrorDetail(CREDITS);
    assert.equal(detail?.code, "upstream_rejected");
    assert.equal(detail?.retryable, false);
    assert.equal(detail?.message, CREDITS_SENTENCE);
  });

  it("strips Pi's Responses prefix too", () => {
    assert.equal(
      parseGatewayErrorDetail(CONNECTION_LOST)?.message,
      CONNECTION_LOST_SENTENCE,
    );
  });
});

describe("classifyRunError shows the three observed failures", () => {
  // `hidden` is what `inprocess` asks for, where an unrecognized error became a reference.
  const classify = (text: string) =>
    classifyRunError(new Error(text), "pi_core", "openai", {
      unknownText: "hidden",
    });

  it("an error frame inside a 200 stream", () => {
    const classified = classify(INCIDENT);
    assert.equal(classified.message, INCIDENT_SENTENCE);
    assert.equal(classified.code, "upstream_error");
    assert.equal(classified.detail?.retryable, true);
  });

  it("an account out of credit", () => {
    const classified = classify(CREDITS);
    assert.equal(classified.message, CREDITS_SENTENCE);
    assert.equal(classified.code, "upstream_rejected");
    assert.equal(classified.detail?.retryable, false);
  });

  it("a starter-credits budget refusal, relayed unmarked, keeps its own sentence and class", () => {
    const budget =
      "Internal error: 400: " +
      JSON.stringify({
        message: "Budget has been exceeded! Current cost: 5.01, Max budget: 5.0",
        type: "budget_exceeded",
        code: "400",
      });
    const classified = classify(budget);
    assert.equal(classified.code, "starter_credits_exhausted");
    assert.doesNotMatch(classified.message, /5\.01/);
  });

  it("another endpoint's budget refusal stays that endpoint's own error", () => {
    const budget =
      "Internal error: 400: " +
      JSON.stringify({
        message:
          'The model reported an error: "Budget has been exceeded". ' +
          "Check the endpoint's key, account and model, or change the request. " +
          "⟦agenta_code:upstream_rejected⟧",
        code: "400",
      });
    assert.equal(classify(budget).code, "upstream_rejected");
  });

  it("a tool call the provider could not read", () => {
    const classified = classify(MALFORMED);
    assert.equal(classified.code, "upstream_error");
    assert.match(classified.message, /malformed_function_call\)\. Try again/);
  });
});

describe("the live event and the stored result agree", () => {
  it("carry the same code and envelope", async () => {
    const { deps, events } = fakeHarness({ promptError: new Error(INCIDENT) });

    const result = await runSandboxAgent(
      { harness: "pi_core", messages: [{ role: "user", content: "hi" }] },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    const errors = events.filter(
      (event: AgentEvent) => event.type === "error",
    ) as Array<Extract<AgentEvent, { type: "error" }>>;
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.message, INCIDENT_SENTENCE);
    assert.equal(errors[0]!.code, "upstream_error");
    assert.equal(result.error, INCIDENT_SENTENCE);
    assert.deepEqual(result.errorDetail, errors[0]!.detail);
    assert.equal(result.errorDetail?.retryable, true);
  });
});

describe("Pi retries exactly as it did before the gateway rewrote the message", () => {
  // `isRetryableAssistantError` reads only the message text (pi-ai `utils/retry.js`).
  const retries = (errorMessage: string) =>
    isRetryableAssistantError({ stopReason: "error", errorMessage } as never);

  it.each([
    ["the incident's error frame", "Upstream request failed", INCIDENT_SENTENCE],
    [
      "an account out of credit",
      '402: {"message":"You have no credits remaining","code":"insufficient_quota"}',
      CREDITS.replace("Internal error: ", ""),
    ],
    [
      "a rate limit",
      '429: {"message":"Rate limit reached","code":"rate_limit_exceeded"}',
      '429: {"message":"The model reported an error: \\"Rate limit reached\\". Try again.","code":"rate_limit_exceeded"}',
    ],
    ["a stream cut off mid-answer", "terminated", CONNECTION_LOST_SENTENCE],
    [
      "a server error, relayed with the upstream's status instead of 502",
      '502: {"message":"upstream request failed","code":"upstream_error"}',
      '503: {"message":"The model reported an error: \\"Service Unavailable\\". Try again.","code":null}',
    ],
  ])("%s", (_name, before, after) => {
    assert.equal(retries(after), retries(before));
  });
});

describe("the sentence ends at its marker", () => {
  it("drops what a harness wrote after it", () => {
    const text = `${INCIDENT}\n    at Object.prompt (agent.js:1:1) ⟦agenta_code:upstream_error⟧`;
    assert.equal(parseGatewayErrorDetail(text)?.message, INCIDENT_SENTENCE);
  });
});
