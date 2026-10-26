/**
 * The native Gemini route answers a refusal in Google's shape, `{"error": {"code": <HTTP status>,
 * "message": "... ⟦agenta_code:<code>⟧", "status": "<CANONICAL>"}}`, and Pi's Google client keeps
 * only that body as its error text (no `403 ` status prefix like the OpenAI client's). Every such
 * error must read as it did on the OpenAI route, never as an unclassified run error.
 */
import { describe, expect, it } from "vitest";

import { classifyRunError } from "../../src/engines/sandbox_agent/errors.ts";
import { parseGatewayErrorDetail } from "../../src/gateway-error.ts";

const MARK = (code: string) => `⟦agenta_code:${code}⟧`;

function google(status: number, canonical: string, message: string): string {
  return JSON.stringify({ error: { code: status, message, status: canonical } });
}

function openai(status: number, message: string, code: string): string {
  return `${status} ${JSON.stringify({ error: { message, type: "invalid_request_error", code } })}`;
}

const CASES = [
  {
    name: "a model the connection does not allow (403)",
    status: 403,
    canonical: "PERMISSION_DENIED",
    code: "model_not_allowed",
    message: `Model 'google/gemini-2.0-flash' is not allowed on builtin/agenta. ${MARK("model_not_allowed")}`,
  },
  {
    name: "a capability the built-in endpoint does not price (400)",
    status: 400,
    canonical: "INVALID_ARGUMENT",
    code: "capability_not_allowed",
    message: `Request field 'tools' asks for a capability builtin/agenta does not offer. ${MARK("capability_not_allowed")}`,
  },
  {
    name: "Vertex out of capacity (429)",
    status: 429,
    canonical: "RESOURCE_EXHAUSTED",
    code: "upstream_error",
    message: `The model reported an error. Try again in a moment. ${MARK("upstream_error")}`,
  },
  {
    name: "Vertex failing (502)",
    status: 502,
    canonical: "UNAVAILABLE",
    code: "upstream_error",
    message: `The model reported an error. Try again in a moment. ${MARK("upstream_error")}`,
  },
  {
    name: "the gateway's own timeout (504)",
    status: 504,
    canonical: "DEADLINE_EXCEEDED",
    code: "upstream_error",
    message: `The model provider did not answer in time. ${MARK("upstream_error")}`,
  },
];

describe("gateway errors in Google's shape (the native Gemini route)", () => {
  for (const c of CASES) {
    it(`classifies ${c.name} as the OpenAI route did, never as unclassified`, () => {
      const viaGoogle = classifyRunError(
        new Error(`Internal error: ${google(c.status, c.canonical, c.message)}`),
        "pi_core",
        "agenta",
        { unknownText: "hidden" },
      );
      const viaOpenAI = classifyRunError(
        new Error(`Internal error: ${openai(c.status, c.message, c.code)}`),
        "pi_core",
        "agenta",
        { unknownText: "hidden" },
      );

      expect(viaGoogle.code).not.toBe("internal_error");
      // The marker stays, as on the OpenAI route: the runner re-reads it for the gateway's code,
      // and the web app strips it before display.
      expect(viaGoogle.message).not.toMatch(/\{"error"/);
      expect(viaGoogle.code).toBe(viaOpenAI.code);
      expect(viaGoogle.message).toBe(viaOpenAI.message);
    });

    it(`recovers the gateway's code from ${c.name}`, () => {
      const detail = parseGatewayErrorDetail(
        `Internal error: ${google(c.status, c.canonical, c.message)}`,
      );
      expect(detail?.code).toBe(c.code);
      expect(detail?.message).not.toMatch(/\{"error"/);
    });
  }
});

describe("the staging report (v0.125.1, reference 876ec5d2)", () => {
  it("reads the exact text the runner logged as a refusal, not an unclassified error", () => {
    const raw = new Error(
      'Internal error: {"error":{"code":403,"message":"Model google/gemini-2.0-flash not allowed on builtin/agenta ⟦agenta_code:model_not_allowed⟧","status":"PERMISSION_DENIED"}}',
    );
    const classified = classifyRunError(raw, "pi_core", "agenta", { unknownText: "hidden" });
    expect(classified.code).toBe("provider_error");
    expect(classified.message).toMatch(/^The model provider refused the request \(HTTP 403\): Model google\/gemini-2\.0-flash not allowed on builtin\/agenta/);
    expect(parseGatewayErrorDetail(classified.message)).toMatchObject({
      code: "model_not_allowed",
      retryable: false,
    });
  });
});

describe("text that only looks like a Google error", () => {
  it.each([
    ['a tool\'s own error body', 'Tool output validation failed: {"error":{"code":403,"message":"Missing field"}}'],
    ["a provider's own Google error, unmarked", 'Internal error: {"error":{"code":403,"message":"Permission denied on resource project x.","status":"PERMISSION_DENIED"}}'],
    ["a marked body without a status", 'Internal error: {"error":{"code":403,"message":"No ⟦agenta_code:model_not_allowed⟧"}}'],
  ])("is not read as the gateway's refusal: %s", (_name, text) => {
    const classified = classifyRunError(new Error(text), "pi_core", "agenta", { unknownText: "hidden" });
    expect(classified.message).not.toMatch(/^The model provider refused the request \(HTTP 403\)/);
  });
});

describe("Google-shaped refusals that earlier rules own", () => {
  it("keeps the out-of-credits sentence", () => {
    const raw = new Error(
      `Internal error: ${google(403, "PERMISSION_DENIED", `You've used all your organization's credits. ${MARK("wallet_balance_exhausted")}`)}`,
    );
    expect(classifyRunError(raw, "pi_core", "agenta", { unknownText: "hidden" }).code).toBe(
      "wallet_balance_exhausted",
    );
  });

  it("keeps an upstream rejection as the gateway's sentence", () => {
    const raw = new Error(
      `Internal error: ${google(400, "INVALID_ARGUMENT", `The model rejected the request. ${MARK("upstream_rejected")}`)}`,
    );
    expect(classifyRunError(raw, "pi_core", "agenta", { unknownText: "hidden" }).code).toBe(
      "upstream_rejected",
    );
  });
});
