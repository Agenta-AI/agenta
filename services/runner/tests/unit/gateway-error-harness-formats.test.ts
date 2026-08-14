/**
 * Pins OD18's per-harness findings (open-designs.md): does a harness's SDK preserve the
 * gateway's `{"error":{...}}` refusal body in the text `parseGatewayErrorDetail` scans?
 *
 * Pi (`utils/error-body.js`) and the Anthropic SDK (`core/error.js`'s `JSON.stringify`
 * fallback) both fold the full body into the reported message — one shared fixture format
 * below stands in for both. Codex (`codex-rs`'s `extract_error_message`) strips everything but
 * `error.message` before formatting, so no brace survives; that is asserted as `undefined`,
 * not skipped.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { parseGatewayErrorDetail } from "../../src/gateway-error.ts";

interface Refusal {
  name: string;
  status: number;
  code: string;
  message: string;
  type: string;
  nextStep?: string;
  extra?: Record<string, unknown>;
}

// The five refusals launch-3.md names, with the codes `_map_domain_exception`
// (api/oss/src/apis/fastapi/gateways/llms/proxy.py) actually raises for each.
const REFUSALS: Refusal[] = [
  {
    name: "missing credential",
    status: 409,
    code: "secret_missing",
    message: "No project secret for anthropic under mode standard",
    type: "invalid_request_error",
    nextStep: "configure the connection's secret",
  },
  {
    name: "rejected credential",
    status: 424,
    code: "upstream_error",
    message: "401 Unauthorized",
    type: "api_error",
    // upstream_error has no fixed next_step (D16: the upstream's own detail passes through).
  },
  {
    name: "unregistered target",
    status: 404,
    code: "endpoint_not_found",
    message: "No endpoint named 'staging-claude'",
    type: "invalid_request_error",
    nextStep: "check the endpoint configuration",
  },
  {
    name: "disallowed model",
    status: 403,
    code: "model_not_allowed",
    message: "model not allowed: gpt-5.5-experimental",
    type: "invalid_request_error",
    nextStep: "choose a model the connection allows",
  },
  {
    name: "deactivated endpoint",
    status: 403,
    code: "endpoint_inactive",
    message: "Endpoint 'prod-openai' is inactive",
    type: "invalid_request_error",
    nextStep: "reactivate the endpoint, or choose another",
  },
];

function gatewayBody(r: Refusal): string {
  return JSON.stringify({
    error: { message: r.message, type: r.type, code: r.code, ...r.extra },
  });
}

describe("Pi / Anthropic-SDK shape (OD18: confirmed to preserve the body)", () => {
  for (const r of REFUSALS) {
    it(`recovers ${r.code} (${r.name}) from a JSON.stringify-embedded body`, () => {
      // Mirrors `formatProviderError`'s "<status>: <body>" composition (pi-ai's
      // utils/error-body.js) and @anthropic-ai/sdk's `APIError.makeMessage`'s
      // "<status> <JSON.stringify(errorResponse)>" fallback — both land the full body
      // verbatim in the text the runner reads.
      const harnessText = `${r.status}: ${gatewayBody(r)}`;
      const detail = parseGatewayErrorDetail(harnessText);
      assert.equal(detail?.code, r.code);
      assert.equal(detail?.message, r.message);
      assert.equal(detail?.retryable, false);
      if (r.nextStep) assert.equal(detail?.next_step, r.nextStep);
    });
  }
});

describe("Codex shape (OD18: confirmed NOT to preserve the body)", () => {
  for (const r of REFUSALS) {
    it(`cannot recover ${r.code} (${r.name}) from codex-rs's stripped format`, () => {
      // codex-rs's `UnexpectedResponseError::extract_error_message`
      // (codex-rs/protocol/src/error.rs, rust-v0.145.0) parses the body as JSON and keeps
      // ONLY `error.message`, discarding `code`/`type` before formatting this string — no
      // brace remains for the scan to find. This is the harness OD18 records as unable to
      // preserve the cause, not a parser gap.
      const harnessText = `unexpected status ${r.status}: ${r.message}`;
      const detail = parseGatewayErrorDetail(harnessText);
      assert.equal(detail, undefined);
    });
  }
});
