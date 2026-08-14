/**
 * Pins OD18's per-harness findings (open-designs.md): does a harness's SDK preserve the
 * gateway's `{"error":{...}}` refusal body in the text `parseGatewayErrorDetail` scans, and —
 * when it does not — does the `⟦agenta_code:...⟧` marker the gateway now embeds in every typed
 * refusal's `message` (`api/oss/src/apis/fastapi/gateways/llms/proxy.py`) survive instead?
 *
 * Pi (`utils/error-body.js`) and the Anthropic SDK (`core/error.js`'s `JSON.stringify`
 * fallback) both fold the full body into the reported message — the body path wins for them,
 * recovering the full `AgentErrorDetail`. Codex (`codex-rs`'s `extract_error_message`) strips
 * everything but `error.message` — but the marker rides INSIDE that one surviving field, so the
 * marker fallback recovers `code` (and only `code`) for Codex.
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
    status: 409,
    code: "secret_invalid",
    message: "Secret for anthropic:project-42 is invalid",
    type: "invalid_request_error",
    nextStep: "reconnect the connection's secret",
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

// What the gateway actually renders into `message` for a typed refusal (_with_code_marker,
// proxy.py) -- the marker rides inside the one field every harness examined keeps.
function markedMessage(r: Refusal): string {
  return `${r.message} ⟦agenta_code:${r.code}⟧`;
}

function gatewayBody(r: Refusal): string {
  return JSON.stringify({
    error: { message: markedMessage(r), type: r.type, code: r.code, ...r.extra },
  });
}

describe("Pi / Anthropic-SDK shape (OD18: body survives -> full detail)", () => {
  for (const r of REFUSALS) {
    it(`recovers the full envelope for ${r.code} (${r.name}) via the body path`, () => {
      // Mirrors `formatProviderError`'s "<status>: <body>" composition (pi-ai's
      // utils/error-body.js) and @anthropic-ai/sdk's `APIError.makeMessage`'s
      // "<status> <JSON.stringify(errorResponse)>" fallback -- both land the full body
      // verbatim, marker included, in the text the runner reads.
      const harnessText = `${r.status}: ${gatewayBody(r)}`;
      const detail = parseGatewayErrorDetail(harnessText);
      assert.equal(detail?.code, r.code);
      // The body path's `message` is the gateway's raw field, marker and all -- the JSON
      // parse doesn't know to strip it. Only the marker-only fallback strips it (below).
      assert.equal(detail?.message, markedMessage(r));
      assert.equal(detail?.retryable, false);
      if (r.nextStep) assert.equal(detail?.next_step, r.nextStep);
    });
  }
});

describe("Codex shape (OD18: body is stripped -> marker fallback recovers code only)", () => {
  for (const r of REFUSALS) {
    it(`recovers ${r.code} (${r.name}) from codex-rs's stripped format via the marker`, () => {
      // codex-rs's `UnexpectedResponseError::extract_error_message`
      // (codex-rs/protocol/src/error.rs, rust-v0.145.0) parses the body as JSON and keeps
      // ONLY `error.message`, discarding `code`/`type` before formatting this string -- but
      // the marker rides inside that surviving `message`, so it comes along for the ride.
      const harnessText = `unexpected status ${r.status}: ${markedMessage(r)}`;
      const detail = parseGatewayErrorDetail(harnessText);
      assert.equal(detail?.code, r.code);
      // The marker is stripped from the recovered message for display.
      assert.equal(detail?.message, `unexpected status ${r.status}: ${r.message}`);
      assert.equal(detail?.retryable, false);
      // What's still lost on a marker-only harness (WP25 spec): no next_step, no details --
      // never backfilled from NEXT_STEPS, so a caller can tell "code only" from "full detail"
      // and degrade to a generic step-up prompt (WP19) instead of a specific one.
      assert.equal(detail?.next_step, undefined);
      assert.equal(detail?.details, undefined);
    });
  }
});

describe("upstream_error: no marker, by design (D16 passthrough)", () => {
  it("stays undefined when neither the body nor a marker is present", () => {
    const detail = parseGatewayErrorDetail("unexpected status 401: invalid api key");
    assert.equal(detail, undefined);
  });
});
