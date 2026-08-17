/**
 * `parseGatewayErrorDetail`: best-effort recovery of the gateway's structured refusal from a
 * harness-reported error string (WP13, per launch-2.md's Checkpoint B acceptance: a model the
 * connection may not use, or a deactivated endpoint, must fail with the cause named).
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { parseGatewayErrorDetail } from "../../src/gateway-error.ts";
import { withGatewayErrorDetail } from "../../src/engines/sandbox_agent/engine.ts";

const GATEWAY_BODY = JSON.stringify({
  error: {
    message: "model not allowed: gpt-5.5-experimental",
    type: "invalid_request_error",
    code: "model_not_allowed",
  },
});

describe("parseGatewayErrorDetail", () => {
  it("recovers code/message/next_step from a raw embedded gateway body", () => {
    const detail = parseGatewayErrorDetail(GATEWAY_BODY);
    assert.deepEqual(detail, {
      code: "model_not_allowed",
      message: "model not allowed: gpt-5.5-experimental",
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
          message: "max_tokens exceeds the endpoint ceiling",
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
