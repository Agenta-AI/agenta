/**
 * Recover the gateway's structured refusal from a harness-reported error string.
 *
 * Two planes, two wire shapes, and one parser. The LLM gateway's data-plane refusals
 * (`apis/fastapi/gateways/llms/proxy.py` `_map_domain_exception`) are OpenAI-shaped:
 * `{"error": {"message", "type", "code", ...}}`, where `code` is our own string. The MCP gateway's
 * are JSON-RPC: `{"error": {"code": -32000, "message", "data": {"cause", ...}}}`, where `code`
 * belongs to the protocol and our cause sits at `error.data.cause`. A harness's provider SDK is
 * the thing that actually receives that HTTP body. Two recovery paths, tried in order:
 *
 * 1. The JSON body, verbatim, embedded in the harness's error text (most OpenAI/Anthropic-
 *    compatible SDKs fold it into their thrown error's message). Recovers everything:
 *    `code`, `message`, `next_step`, `details`. On the MCP plane `details` is `error.data`,
 *    which is where a refusal carries the action that would fix it — see `jsonRpcCause`.
 * 2. A single machine-readable marker (`⟦agenta_code:<code>⟧`) the gateway appends to every
 *    TYPED refusal's `message` field specifically so `code` survives even when a harness's
 *    SDK strips the JSON structure and keeps only that one field. Recovers
 *    `code` only: `retryable`/`next_step`/`details` are lost on a marker-only harness, and a
 *    caller must degrade to a generic prompt
 *    when it sees no `details`/`next_step` rather than assume one exists.
 *
 * A harness whose SDK discards BOTH — the full body and the marker inside `message` — still
 * yields `undefined`.
 */
import type { AgentErrorDetail, AgentEvent } from "./protocol.ts";

// A distinct marker preserves the error code when a harness discards the error body.
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
  for (
    let start = text.indexOf("{");
    start !== -1;
    start = text.indexOf("{", start + 1)
  ) {
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

/** Does this text still carry the gateway's typed-refusal marker? */
export function carriesGatewayRefusalMarker(text: string | undefined): boolean {
  return !!text && CODE_MARKER_RE.test(text);
}

/**
 * The stream's `error` event, carrying the gateway's envelope whenever the harness's text still
 * holds it.
 *
 * OR28: `code` on this event is the RUNNER's failure class, a vocabulary the client uses to offer
 * a recovery path; the gateway's own `model_not_allowed` never had a field to ride in, so a live
 * stream reached the browser with the refusal as prose and nothing machine-readable. The terminal
 * result has carried `errorDetail` since OR25. This puts the same envelope on the live leg, so one
 * refusal reads the same whichever leg reported it. The two codes stay separate fields rather than
 * one overwritten field, because a named runner class (`starter_credits_exhausted`) and a gateway
 * code answer different questions.
 */
export function errorEventWithDetail(
  message: string,
  code?: string,
): Extract<AgentEvent, { type: "error" }> {
  const detail = parseGatewayErrorDetail(message);
  return {
    type: "error",
    message,
    ...(code ? { code } : {}),
    ...(detail ? { detail } : {}),
  };
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

/**
 * The MCP plane's cause and its structured data, from a JSON-RPC error object.
 *
 * The two planes identify a refusal differently. The LLM plane puts our own string in
 * `error.code`; JSON-RPC reserves `error.code` for its numeric protocol codes (`-32000` and
 * friends), so the MCP proxy carries the stable cause one level down at `error.data.cause` and
 * puts everything a caller might act on beside it in `error.data`.
 *
 * `error.data` is lifted WHOLE rather than filtered, because its most valuable member is the one
 * this parser should know least about: `requirement.connect`, the endpoint that grants the
 * authorization the refusal is complaining about. A parser that allowlists fields would have to be
 * edited every time the API learns to offer a new remedy, and the failure mode of forgetting is
 * silent (OR85: the action was minted, travelled, and was then dropped one layer from its reader).
 */
function jsonRpcCause(
  body: GatewayErrorBody,
): { code: string; details: Record<string, unknown> } | undefined {
  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const cause = (data as { cause?: unknown }).cause;
  if (typeof cause !== "string" || !cause) return undefined;
  return { code: cause, details: { ...(data as Record<string, unknown>) } };
}

/** Path 1: the JSON body survived. Recovers the full envelope. */
function parseFromBody(raw: string): AgentErrorDetail | undefined {
  const parsed = firstJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return undefined;
  const wrapped = (parsed as { error?: GatewayErrorBody }).error;
  // Two shapes reach this scan. Most SDKs fold the gateway's OpenAI-shaped `{"error": {...}}`
  // in verbatim. Pi unwraps it first (`utils/error-body.js`), so its text carries the BARE body
  // — which the wrapper-only scan missed, costing Pi the `next_step` and `details` its message
  // still held (OR28). A bare object is only accepted when its `message` carries the gateway's
  // own marker, so an unrelated JSON blob with `code` and `message` keys is not mistaken for a
  // refusal we authored.
  const bareCandidate = parsed as GatewayErrorBody;
  const bare =
    !wrapped &&
    (typeof bareCandidate.code === "string" || !!jsonRpcCause(bareCandidate)) &&
    typeof bareCandidate.message === "string" &&
    CODE_MARKER_RE.test(String(bareCandidate.message))
      ? bareCandidate
      : undefined;
  const body = wrapped ?? bare;
  if (!body || typeof body !== "object") return undefined;
  // The LLM plane's string `code` wins where it exists; otherwise this is the MCP plane's
  // JSON-RPC shape and the cause comes from `error.data`. Checked in that order so a body
  // carrying both keeps the behaviour it had before the MCP shape was understood here.
  const rpc = typeof body.code === "string" ? undefined : jsonRpcCause(body);
  const code = typeof body.code === "string" ? body.code : rpc?.code;
  const message = typeof body.message === "string" ? body.message : undefined;
  if (!code || !message) return undefined;

  const { message: _m, type, code: _c, data: _d, ...rest } = body;
  const details: Record<string, unknown> = rpc ? rpc.details : rest;
  if (!rpc && typeof type === "string") details.type = type;

  return {
    code,
    message,
    // Parsed gateway refusals are non-retryable without changing the request or configuration.
    retryable: false,
    ...(NEXT_STEPS[code] ? { next_step: NEXT_STEPS[code] } : {}),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

/**
 * Path 2: the body is gone but the marker survived inside whatever text remains (Codex).
 * Recovers `code` only — `next_step` and `details` need the body, and are omitted rather
 * than backfilled from `NEXT_STEPS`, so callers distinguish a code-only result from a full
 * envelope and can use a generic recovery prompt.
 */
function parseFromMarker(raw: string): AgentErrorDetail | undefined {
  const match = raw.match(CODE_MARKER_RE);
  if (!match) return undefined;
  const code = match[1];
  const message = raw.replace(CODE_MARKER_RE, "").trim() || raw;
  return { code, message, retryable: false };
}
