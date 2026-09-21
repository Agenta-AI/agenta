/**
 * `parseGatewayErrorDetail`: best-effort recovery of the gateway's structured refusal from a
 * harness-reported error string.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { parseGatewayErrorDetail } from "../../src/gateway-error.ts";
import { withGatewayErrorDetail } from "../../src/engines/sandbox_agent/engine.ts";

// The marker is what identifies a refusal as OURS, and the gateway stamps it into the message of
// every typed refusal it renders (`with_code_marker`, `api/.../gateways/utils.py`). These fixtures
// predate that guarantee and omitted it; carrying it is what a real body does. See CR11.
const GATEWAY_BODY = JSON.stringify({
  error: {
    message:
      "model not allowed: gpt-5.5-experimental ⟦agenta_code:model_not_allowed⟧",
    type: "invalid_request_error",
    code: "model_not_allowed",
  },
});

describe("parseGatewayErrorDetail", () => {
  it("recovers code/message/next_step from a raw embedded gateway body", () => {
    const detail = parseGatewayErrorDetail(GATEWAY_BODY);
    assert.deepEqual(detail, {
      code: "model_not_allowed",
      message:
        "model not allowed: gpt-5.5-experimental ⟦agenta_code:model_not_allowed⟧",
      retryable: false,
      next_step: "choose a model the connection allows",
      details: { type: "invalid_request_error" },
    });
  });

  it("recovers the body when a harness SDK prefixes it with its own text", () => {
    const detail = parseGatewayErrorDetail(
      `OpenAI API error 403 Forbidden: ${GATEWAY_BODY}\nat Foo.bar (/app/x.js:1:1)`,
    );
    assert.equal(detail?.code, "model_not_allowed");
  });

  it("carries the ceiling_exceeded extras into details", () => {
    const detail = parseGatewayErrorDetail(
      JSON.stringify({
        error: {
          message:
            "max_tokens exceeds the endpoint ceiling ⟦agenta_code:ceiling_exceeded⟧",
          type: "invalid_request_error",
          code: "ceiling_exceeded",
          ceiling: 4096,
          requested: 8192,
          allowed: 4096,
        },
      }),
    );
    assert.equal(detail?.code, "ceiling_exceeded");
    assert.equal(detail?.retryable, false);
    assert.deepEqual(detail?.details, {
      type: "invalid_request_error",
      ceiling: 4096,
      requested: 8192,
      allowed: 4096,
    });
  });

  it("does not claim a provider's own OpenAI-shaped error as a gateway refusal (CR11)", () => {
    // `{"error": {"message", "type", "code"}}` is the shape every OpenAI-compatible provider uses
    // for its OWN errors. Accepting it on shape alone parsed someone else's rate limit into an
    // Agenta refusal and stamped it `retryable: false` — a claim about our policy, made over a
    // body we did not write, and wrong: a rate limit IS retryable.
    const providerBody = JSON.stringify({
      error: {
        message: "Rate limit reached for gpt-5.5 in organization org-x",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    });

    assert.equal(parseGatewayErrorDetail(providerBody), undefined);
  });

  it("does not claim the gateway's own unmarked upstream_error (CR11)", () => {
    // `upstream_error` is the one refusal the gateway renders WITHOUT the marker, deliberately:
    // an upstream transport failure is not a typed refusal of ours (`marked=False` in
    // `llms/proxy.py`). Claiming it told the caller a non-retryable policy decision had been made
    // about a request that simply failed to reach anyone.
    const body = JSON.stringify({
      error: {
        message: "upstream request failed",
        type: "api_error",
        code: "upstream_error",
      },
    });

    assert.equal(parseGatewayErrorDetail(body), undefined);
  });

  it("is undefined for a plain harness error with no embedded gateway body", () => {
    assert.equal(
      parseGatewayErrorDetail("claude: model authentication failed"),
      undefined,
    );
  });

  it("is undefined for undefined input, malformed JSON, and a body missing code/message", () => {
    assert.equal(parseGatewayErrorDetail(undefined), undefined);
    assert.equal(parseGatewayErrorDetail("not json {here"), undefined);
    assert.equal(
      parseGatewayErrorDetail(JSON.stringify({ error: { type: "x" } })),
      undefined,
    );
  });
});

describe("withGatewayErrorDetail (the engine's choke point)", () => {
  it("attaches errorDetail to a failed result whose error embeds a gateway refusal", () => {
    const result = withGatewayErrorDetail({ ok: false, error: GATEWAY_BODY });
    assert.equal(result.errorDetail?.code, "model_not_allowed");
    assert.equal(result.error, GATEWAY_BODY); // the plain string is unchanged
  });

  it("leaves an ok:true result and a plain-string failure untouched", () => {
    const ok = withGatewayErrorDetail({ ok: true, output: "hi" });
    assert.equal(ok.errorDetail, undefined);

    const plain = withGatewayErrorDetail({ ok: false, error: "boom" });
    assert.equal(plain.errorDetail, undefined);
    assert.equal(plain.error, "boom");
  });

  it("never overwrites an errorDetail the caller already set", () => {
    const result = withGatewayErrorDetail({
      ok: false,
      error: GATEWAY_BODY,
      errorDetail: { code: "already_set", message: "x", retryable: false },
    });
    assert.equal(result.errorDetail?.code, "already_set");
  });
});
