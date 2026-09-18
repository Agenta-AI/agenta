/**
 * Verifies whether a harness's SDK preserves the LLM
 * gateway's `{"error":{...}}` refusal body in the text `parseGatewayErrorDetail` scans, and —
 * when it does not — does the `⟦agenta_code:...⟧` marker the gateway now embeds in every typed
 * refusal's `message` (`gateways/utils.py::with_code_marker`, shared by both
 * `gateways/llms/proxy.py` and `gateways/mcps/proxy.py`) survive instead?
 *
 * Pi (`utils/error-body.js`) and the Anthropic SDK (`core/error.js`'s `JSON.stringify`
 * fallback) both fold the full LLM-plane body into the reported message — the body path wins
 * for them, recovering the full `AgentErrorDetail`. Codex (`codex-rs`'s
 * `extract_error_message`) strips everything but `error.message` — but the marker rides
 * INSIDE that one surviving field, so the marker fallback recovers `code` (and only `code`)
 * for Codex.
 *
 * The MCP plane's wire shape (JSON-RPC) never matches the LLM-plane body scan at all (its
 * stable cause lives at `error.data.cause`, under a numeric `error.code` the scan doesn't
 * recognize as ours) — so for that plane the marker is not a fallback for one harness, it is
 * the only channel, on every harness, proven separately below.
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

// Representative typed gateway refusals.
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
    error: {
      message: markedMessage(r),
      type: r.type,
      code: r.code,
      ...r.extra,
    },
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
      // Codex parses the body as JSON and keeps
      // ONLY `error.message`, discarding `code`/`type` before formatting this string -- but
      // the marker rides inside that surviving `message`, so it comes along for the ride.
      const harnessText = `unexpected status ${r.status}: ${markedMessage(r)}`;
      const detail = parseGatewayErrorDetail(harnessText);
      assert.equal(detail?.code, r.code);
      // The marker is stripped from the recovered message for display.
      assert.equal(
        detail?.message,
        `unexpected status ${r.status}: ${r.message}`,
      );
      assert.equal(detail?.retryable, false);
      // Marker-only recovery exposes the code without next steps or details.
      assert.equal(detail?.next_step, undefined);
      assert.equal(detail?.details, undefined);
    });
  }
});

describe("upstream_error: no marker, by design (D16 passthrough)", () => {
  it("stays undefined when neither the body nor a marker is present", () => {
    const detail = parseGatewayErrorDetail(
      "unexpected status 401: invalid api key",
    );
    assert.equal(detail, undefined);
  });
});

// The MCP plane (`gateways/mcps/proxy.py::_map_gateway_exception`) shares the same
// `with_code_marker` helper (`gateways/utils.py`) but a DIFFERENT wire shape: a JSON-RPC
// error result whose stable identifier is `error.data.cause` (a string) under a numeric
// `error.code` (JSON-RPC's own reserved code, e.g. -32000) -- not the LLM plane's
// `error.code` string `parseFromBody` looks for. So the body path never recognizes an MCP
// refusal at all, marker or not; the marker fallback is the ONLY channel that reaches an
// MCP cause, on every harness, not just the ones that fail the LLM plane's body scan.
const MCP_REFUSALS: Refusal[] = [
  {
    name: "missing credential",
    status: 409,
    code: "secret_missing",
    message: "No project secret for acme-notion under mode standard",
    type: "invalid_request_error",
  },
  {
    name: "rejected credential",
    status: 409,
    code: "secret_invalid",
    message: "Secret for custom/acme-notion is invalid",
    type: "invalid_request_error",
  },
  {
    name: "unregistered target",
    status: 404,
    code: "endpoint_not_found",
    message: "No endpoint named 'acme-notion'",
    type: "invalid_request_error",
  },
  {
    name: "deactivated endpoint",
    status: 403,
    code: "endpoint_inactive",
    message: "Endpoint 'acme-notion' is inactive",
    type: "invalid_request_error",
  },
  {
    // MCP scope challenges use the same marker recovery as other MCP causes.
    name: "insufficient scope (step-up)",
    status: 409,
    code: "scope_insufficient",
    message: "Additional scopes required for custom/acme-notion: ['write']",
    type: "invalid_request_error",
  },
  {
    // A connection with no usable authorization: never connected, disconnected, or one
    // whose credential the provider retired. The gateway's envelope carries the action
    // that fixes it in `error.data.requirement.connect`; see the case below for how much
    // of that survives to here.
    name: "unauthorized connection",
    status: 409,
    code: "auth_required",
    message: "custom/acme-notion requires authorization",
    type: "invalid_request_error",
  },
];

function mcpJsonRpcBody(r: Refusal): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32000, message: markedMessage(r), data: { cause: r.code } },
  });
}

describe("MCP plane, JSON-RPC shape embedded verbatim (body scan doesn't recognize it -> marker still recovers code)", () => {
  for (const r of MCP_REFUSALS) {
    it(`recovers ${r.code} (${r.name}) even with the full JSON-RPC body intact`, () => {
      // The JSON-RPC body's own `error.code` is a NUMBER (-32000), not our string cause, so
      // parseFromBody's `typeof body.code === "string"` check fails here even when a harness
      // preserves the whole body verbatim -- this proves the marker is not merely a Codex
      // fallback, it is the only channel for this plane's shape, full body or not.
      const harnessText = `MCP tool call failed: ${mcpJsonRpcBody(r)}`;
      const detail = parseGatewayErrorDetail(harnessText);
      assert.equal(detail?.code, r.code);
      assert.equal(detail?.retryable, false);
    });
  }
});

describe("MCP plane, Codex-stripped shape (message only, marker still recovers code)", () => {
  for (const r of MCP_REFUSALS) {
    it(`recovers ${r.code} (${r.name}) from an MCP refusal reduced to its bare message`, () => {
      const harnessText = `MCP error: ${markedMessage(r)}`;
      const detail = parseGatewayErrorDetail(harnessText);
      assert.equal(detail?.code, r.code);
      assert.equal(detail?.message, `MCP error: ${r.message}`);
      assert.equal(detail?.next_step, undefined);
      assert.equal(detail?.details, undefined);
    });
  }
});

describe("MCP plane: a refusal's structured action reaches the runner", () => {
  it("recovers the auth_required cause AND the connect action beside it", () => {
    // The gateway answers an unauthorized MCP connection with a `requirement` carrying the
    // connect action, precisely so a run can tell someone how to fix it. The body path used to
    // decline the whole envelope — the JSON-RPC `error.code` is the numeric -32000 rather than
    // our string cause — so the marker path recovered `code` alone and the endpoint that would
    // grant the authorization arrived as prose inside `message`. OR85.
    //
    // This case was written as the loss and is now written as the fix, which is what a
    // characterization test is for: the change to the parsing had to come here and say so.
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message:
          "custom/acme-notion requires authorization ⟦agenta_code:auth_required⟧",
        data: {
          cause: "auth_required",
          requirement: {
            target: "custom/acme-notion",
            state: "needs_auth",
            connect: {
              endpoint: "/gateways/mcps/endpoints/acme/connect",
              body: {},
            },
          },
        },
      },
    });

    const detail = parseGatewayErrorDetail(`MCP tool call failed: ${body}`);

    assert.equal(detail?.code, "auth_required");
    assert.equal(detail?.retryable, false);
    // The whole of `error.data`, so a caller reads the remedy rather than the complaint.
    assert.deepEqual(detail?.details, {
      cause: "auth_required",
      requirement: {
        target: "custom/acme-notion",
        state: "needs_auth",
        connect: {
          endpoint: "/gateways/mcps/endpoints/acme/connect",
          body: {},
        },
      },
    });
    // `auth_required` has no NEXT_STEPS entry and deliberately gains none: the remedy is the
    // endpoint in `details`, not a sentence. See OR85.
    assert.equal(detail?.next_step, undefined);
  });

  it("keeps the marker path for an MCP refusal whose body the harness stripped", () => {
    // The body path is now the better path, not the only one. A harness that discarded the
    // envelope still recovers the cause, and still recovers nothing beside it — which is why a
    // caller must branch on `details` being present rather than assume it.
    const detail = parseGatewayErrorDetail(
      "MCP error: custom/acme-notion requires authorization ⟦agenta_code:auth_required⟧",
    );

    assert.equal(detail?.code, "auth_required");
    assert.equal(detail?.details, undefined);
  });

  it("still reads an LLM-plane refusal, whose code is its own string", () => {
    // The two shapes share one parser, so the MCP change has to leave this untouched: a string
    // `error.code` wins, and `details` stays the remaining body fields rather than `error.data`.
    const body = JSON.stringify({
      error: {
        message: "model not allowed ⟦agenta_code:model_not_allowed⟧",
        type: "invalid_request_error",
        code: "model_not_allowed",
        allowed: ["gpt-5.5"],
      },
    });

    const detail = parseGatewayErrorDetail(`LLM call failed: ${body}`);

    assert.equal(detail?.code, "model_not_allowed");
    assert.equal(detail?.next_step, "choose a model the connection allows");
    assert.deepEqual(detail?.details, {
      allowed: ["gpt-5.5"],
      type: "invalid_request_error",
    });
  });
});
