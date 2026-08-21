/**
 * What the runner says when an OTLP trace export does not land.
 *
 * Cloud exports failed with a bare `otel: trace export failed <traceId> OTLPExporterError:
 * Unauthorized` for a week: no status, no endpoint, and nothing about the credential — so an
 * export credential that had aged out (the actual cause) looked exactly like a wrong one, and
 * a batch carrying no credential at all was sent anyway and reported the same 401.
 *
 * Every non-landing export goes through `logExportProblem`, so the three outcomes (rejected,
 * threw, skipped) share one shape a log query can parse.
 */
import type { Redactor } from "../redaction.ts";

/** Auth schemes we are willing to echo into a log. Anything else reports as "other", so a
 *  malformed header value can never put token bytes in a log line. */
const KNOWN_AUTH_SCHEMES = ["Secret", "ApiKey", "Bearer", "Access"];

/** Log field caps. Applied AFTER redaction (see `logExportProblem`). */
const MAX_RESPONSE_CHARS = 200;
const MAX_ERROR_CHARS = 200;
const MAX_STACK_CHARS = 600;

/** Host of an OTLP endpoint. Logs carry the host, never the full caller-supplied URL. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unparseable";
  }
}

/**
 * What an export credential says about itself. Agenta mints the export credential as a
 * short-lived JWT, so a 401 from a credential that aged out is otherwise indistinguishable
 * from a 401 from a wrong one. Read from the token's own `iat`/`exp` claims; the token itself
 * is never returned or logged.
 */
export interface CredentialAge {
  /** Auth scheme; "none" when the export carries no credential at all. */
  scheme: string;
  /** Seconds since the JWT was issued, when it carries an `iat` claim. */
  ageSeconds?: number;
  /** Seconds until the JWT expires; negative once it has. */
  expiresInSeconds?: number;
  /** True when `exp` is in the past — the credential names itself as the cause of a 401. */
  expired?: boolean;
}

/** Claims of a JWT. Diagnostics only: no signature is checked and nothing here decides access. */
function jwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return claims && typeof claims === "object" ? claims : undefined;
  } catch {
    return undefined;
  }
}

export function describeCredential(authorization?: string): CredentialAge {
  if (!authorization?.trim()) return { scheme: "none" };
  // "<Scheme> <token>", or a bare token with no scheme: either way the credential is the last
  // token, and a scheme only exists when something followed it.
  const [first, ...rest] = authorization.trim().split(/\s+/);
  const scheme =
    rest.length > 0 && KNOWN_AUTH_SCHEMES.includes(first) ? first : "other";
  const claims = jwtClaims(rest.at(-1) ?? first);
  const age: CredentialAge = { scheme };
  if (!claims) return age;
  const now = Date.now() / 1000;
  if (typeof claims.iat === "number")
    age.ageSeconds = Math.round(now - claims.iat);
  if (typeof claims.exp === "number") {
    age.expiresInSeconds = Math.round(claims.exp - now);
    age.expired = age.expiresInSeconds < 0;
  }
  return age;
}

/**
 * The exhausted-retry message otlp-exporter-base 0.220 raises for the whole RETRYABLE status
 * class (408, 429, 5xx). That path resolves without an HTTP response object, so the error it
 * finally reports carries no `code` and no body — the status is genuinely unavailable, however
 * the log is written. Naming the class is the most a log can say there; without it a throttled
 * or quota-rejected export is indistinguishable from a transport error.
 */
const RETRYABLE_EXHAUSTED = "Export failed with retryable status";

/** What an OTLP failure says about itself. `OTLPExporterError.code` is the HTTP status (a
 *  transport-level failure — DNS, refused connection — carries a string code or none) and its
 *  `data` is the rejecting endpoint's own body, which is what turns "Unauthorized" into a
 *  reason. Body is returned WHOLE: it is truncated only after redaction, or a secret straddling
 *  the cut would survive as a prefix. */
function describeExportError(error: unknown): {
  status?: number;
  statusClass?: string;
  response?: string;
} {
  const { code, data, message } = (error ?? {}) as {
    code?: unknown;
    data?: unknown;
    message?: unknown;
  };
  return {
    status: typeof code === "number" ? code : undefined,
    statusClass:
      message === RETRYABLE_EXHAUSTED ? "retryable (408/429/5xx)" : undefined,
    response: typeof data === "string" && data ? data : undefined,
  };
}

/** The text of anything thrown: an Error's message, else the value itself, else its JSON. A
 *  string or object throw has no `.message`, and reporting nothing is how a failure goes
 *  unexplained — an object that stringifies to "[object Object]" says the least of all. */
function errorText(error: unknown): string | undefined {
  if (error == null) return undefined;
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message) return message;
  const text = String(error);
  if (text && text !== "[object Object]") return text;
  try {
    return JSON.stringify(error);
  } catch {
    return undefined;
  }
}

function truncate(text: string | undefined, limit: number): string | undefined {
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

const OUTCOME_MESSAGES = {
  failed: "otel: trace export failed",
  threw: "otel: trace export threw",
  skipped: "otel: trace export skipped, no credential",
} as const;

/**
 * Report one batch that did not land. The endpoint's response and the error text are
 * caller-derived, so they run through the trace's own deny-set on the way out — the same
 * sink-level rule the exported spans follow — and are truncated only afterwards.
 *
 * A `threw` outcome also carries the stack: that outcome means the exporter itself blew up
 * (a misconfigured one, say), and the frame is what names it. A rejected export's stack is
 * always the same transport frame, so it is left out there.
 */
export function logExportProblem(problem: {
  outcome: keyof typeof OUTCOME_MESSAGES;
  traceId: string;
  endpoint: string;
  authorization?: string;
  spans: number;
  error?: unknown;
  redactors?: Iterable<Redactor>;
}): void {
  const redact = (text?: string): string | undefined => {
    if (!text) return undefined;
    let out = text;
    // `?? out` is the type narrowing, not a runtime fallback: redactString is declared
    // `string | null | undefined` (it passes a nullish input straight back).
    for (const redactor of problem.redactors ?? [])
      out = redactor.redactString(out, "stderr") ?? out;
    return out;
  };
  const { status, statusClass, response } = describeExportError(problem.error);
  const stack =
    problem.outcome === "threw" && problem.error instanceof Error
      ? problem.error.stack
      : undefined;
  console.error(
    OUTCOME_MESSAGES[problem.outcome],
    JSON.stringify({
      traceId: problem.traceId,
      endpoint: endpointHost(problem.endpoint),
      status,
      statusClass,
      credential: describeCredential(problem.authorization),
      spans: problem.spans,
      error: truncate(redact(errorText(problem.error)), MAX_ERROR_CHARS),
      response: truncate(redact(response), MAX_RESPONSE_CHARS),
      stack: truncate(redact(stack), MAX_STACK_CHARS),
    }),
  );
}
