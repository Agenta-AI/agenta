/**
 * Recover the gateway's structured refusal from a harness-reported error string.
 *
 * The LLM gateway's data-plane refusals (`apis/fastapi/gateways/llms/proxy.py`
 * `_map_domain_exception`) are OpenAI-shaped: `{"error": {"message", "type", "code", ...}}`.
 * A harness's provider SDK is the thing that actually receives that HTTP body. Two recovery
 * paths, tried in order (OD18, `open-designs.md`):
 *
 * 1. The JSON body, verbatim, embedded in the harness's error text (most OpenAI/Anthropic-
 *    compatible SDKs fold it into their thrown error's message). Recovers everything:
 *    `code`, `message`, `next_step`, `details`.
 * 2. A single machine-readable marker (`⟦agenta_code:<code>⟧`) the gateway appends to every
 *    TYPED refusal's `message` field specifically so `code` survives even when a harness's
 *    SDK strips the JSON structure and keeps only that one field — confirmed for Codex
 *    (`codex-rs`'s `extract_error_message` discards everything but `error.message`). Recovers
 *    `code` only: `retryable`/`next_step`/`details` are lost on a marker-only harness, and a
 *    caller of this function (WP19's step-up interaction) must degrade to a generic prompt
 *    when it sees no `details`/`next_step` rather than assume one exists.
 *
 * A harness whose SDK discards BOTH — the full body and the marker inside `message` — still
 * yields `undefined`; no harness examined does this (OD18).
 */
import type { AgentErrorDetail } from "./protocol.ts";

// U+27E6/U+27E7 (MATHEMATICAL LEFT/RIGHT WHITE SQUARE BRACKET): chosen because they never
// occur in ordinary error prose, a model's own output, JSON delimiters (`{}`/`[]`), or
// markdown, so nothing else can produce or be mistaken for this marker. Must match the gateway
// (`api/oss/src/apis/fastapi/gateways/llms/proxy.py` `_CODE_MARKER_OPEN`/`_CLOSE`).
const CODE_MARKER_RE = /⟦agenta_code:([a-z_]+)⟧/;

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
  secret_invalid: "reconnect the connection's secret",
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
  const fromBody = parseFromBody(raw);
  if (fromBody) return fromBody;
  return parseFromMarker(raw);
}

/** Path 1: the JSON body survived. Recovers the full envelope. */
function parseFromBody(raw: string): AgentErrorDetail | undefined {
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

/**
 * Path 2: the body is gone but the marker survived inside whatever text remains (Codex).
 * Recovers `code` only — `next_step` and `details` need the body, and are omitted rather
 * than backfilled from `NEXT_STEPS`, so a caller (WP19) can tell "only a code" from "the
 * full envelope" and degrade to a generic step-up prompt instead of a specific one.
 */
function parseFromMarker(raw: string): AgentErrorDetail | undefined {
  const match = raw.match(CODE_MARKER_RE);
  if (!match) return undefined;
  const code = match[1];
  const message = raw.replace(CODE_MARKER_RE, "").trim() || raw;
  return { code, message, retryable: false };
}
