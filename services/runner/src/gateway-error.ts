/**
 * Recover the gateway's structured refusal from a harness-reported error string.
 *
 * The LLM gateway's data-plane refusals (`apis/fastapi/gateways/llms/proxy.py`
 * `_map_domain_exception`) are OpenAI-shaped: `{"error": {"message", "type", "code", ...}}`.
 * A harness's provider SDK is the thing that actually receives that HTTP body, and most
 * OpenAI/Anthropic-compatible SDKs fold the raw body into their thrown error's message — so by
 * the time the runner sees a harness error string, the JSON is (often, not always) still in
 * there verbatim. This is a best-effort recovery, not a guarantee: a harness whose SDK discards
 * the body before formatting its own message yields `undefined`, and the plain `error` string
 * stays the only signal (unchanged behavior). Verifying which harness release preserves it is
 * the natural follow-up to OD14's matrix; not run here.
 */
import type { AgentErrorDetail } from "./protocol.ts";

interface GatewayErrorBody {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  [key: string]: unknown;
}

/** Refusal codes the gateway raises before dialling the upstream — never retryable as-is; the
 * caller must change the request or its configuration, not repeat the same bytes. */
const NEXT_STEPS: Record<string, string> = {
  model_not_allowed: "choose a model the connection allows",
  endpoint_inactive: "reactivate the endpoint, or choose another",
  ceiling_exceeded: "reduce the request below the endpoint's ceiling",
  policy_denied: "check the connection's policy",
  secret_missing: "configure the connection's secret",
  endpoint_not_found: "check the endpoint configuration",
  adapter_not_found: "check the endpoint configuration",
};

/** The first balanced `{...}` JSON object in `text`, or undefined if none parses. Scans left to
 * right so the FIRST candidate wins, matching where a formatted error message places the body. */
function firstJsonObject(text: string): unknown {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break; // not valid JSON from this `{`; try the next one
          }
        }
      }
    }
  }
  return undefined;
}

/** Parse a harness error string for an embedded gateway refusal body, or undefined. */
export function parseGatewayErrorDetail(
  raw: string | undefined,
): AgentErrorDetail | undefined {
  if (!raw) return undefined;
  const parsed = firstJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return undefined;
  const body = (parsed as { error?: GatewayErrorBody }).error;
  if (!body || typeof body !== "object") return undefined;
  const code = typeof body.code === "string" ? body.code : undefined;
  const message = typeof body.message === "string" ? body.message : undefined;
  if (!code || !message) return undefined;

  const { message: _m, type, code: _c, ...details } = body;
  if (typeof type === "string") details.type = type;

  return {
    code,
    message,
    // Every code the gateway raises before dialling upstream is a policy/config refusal, not a
    // transient one; `upstream_error` (the one code that could be transient) has no reliable
    // signal in the harness-formatted text either, so it stays conservative rather than telling
    // a model to retry a permanent failure (api/AGENTS.md's retryable guidance).
    retryable: false,
    ...(NEXT_STEPS[code] ? { next_step: NEXT_STEPS[code] } : {}),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}
