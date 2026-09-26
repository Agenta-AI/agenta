import { randomBytes } from "node:crypto";
import { SubstitutionStuckError } from "./credential-preflight.ts";

/** Map a provider family to its human-facing vault key label, for the credit/auth hint. */
const PROVIDER_KEY_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  mistral: "Mistral",
  mistralai: "Mistral",
  minimax: "MiniMax",
  groq: "Groq",
  together_ai: "Together AI",
  openrouter: "OpenRouter",
  xai: "xAI",
};

/**
 * The vault-key hint phrase for an error, named after the RESOLVED provider rather than the
 * harness. A Pi run against an Anthropic model must say "Anthropic key", not "OpenAI key" — the
 * harness name (`pi_core`/`claude`) is not the provider, so deriving the hint from it mislabels
 * every cross-provider run (e.g. Pi + Anthropic wrongly read "check the project's OpenAI key").
 *
 * `provider` is the resolved provider the runner already knows (`request.modelConnection.provider`, from the
 * resolved connection). When it is absent, fall back to the harness default
 * — Claude is always Anthropic; every other harness defaults to OpenAI, matching the old
 * behavior for that path only.
 *
 * A CUSTOM deployment overrides the family label entirely: its provider family is "openai"
 * because the endpoint speaks the OpenAI dialect, not because the key is an OpenAI key — a
 * Gemini run through an OpenAI-compatible proxy must not read "add the project's OpenAI key".
 * The hint names the connection instead, which is where that key actually lives.
 */
function keyHintFor(
  provider: string | undefined,
  harness: string,
  connection?: ConciseErrorOptions["connection"],
): string {
  if (connection?.deployment === "custom") {
    // NEUTRAL on purpose: the runner cannot tell a user-created connection from a managed one
    // (the seeded starter-credits connection is write-only and hidden from Settings), so naming
    // the slug can both leak an internal identifier and instruct the user to edit a connection
    // they cannot see. Review finding on #6362.
    return "the model connection's API key";
  }
  const label = provider
    ? PROVIDER_KEY_LABELS[provider.toLowerCase()]
    : undefined;
  if (label) return `the project's ${label} key`;
  if (harness === "claude") return "the project's Anthropic key";
  return "the project's OpenAI key";
}

/**
 * Stable machine-readable classes for a failed run, carried alongside the human line so a client
 * can render a purposeful state (an "add your own key" call to action, a retry affordance) instead
 * of parsing prose. Never a display string — the wording changes, these do not.
 *
 * `runner_error` is the catch-all every unclassified failure keeps, matching what the SDK stamped
 * on runner-reported errors before the runner had a say.
 */
/**
 * Markers the runner puts in an error message so `classifyRunError` can set the class.
 *
 * Both are strings only this runner produces, so a match needs no corroboration. They live
 * here, next to the codes they map to, and are imported by the modules that raise them.
 */
export const SANDBOX_GONE_MARKER = "sandbox is gone";
export const ABANDONED_TURN_MARKER = "execution abandoned";

/** The line the user reads when the machine running their turn disappeared. */
export const SANDBOX_GONE_MESSAGE =
  "The sandbox running this session stopped responding, so the run was ended. " +
  "Send the message again to start a fresh sandbox.";

/** Why a shutdown ends the turns it interrupts. */
export const RUNNER_SHUTDOWN_REASON = "the runner is shutting down";

/** The line the user reads when a restart ended their turn; a resend reaches the new process. */
export const RUNNER_RESTARTING_MESSAGE =
  "The agent service restarted, so this turn was ended. Send the message again in a moment.";

/** The line the user reads when the run never produced an outcome of its own. */
export const EXECUTION_LOST_MESSAGE =
  "The agent stopped responding and the run was closed. Send the message again to retry.";

export type RunErrorCode =
  | "runner_error"
  // The sandbox provider (or this runner's own sandbox admission) is at capacity; retryable later.
  | "sandbox_capacity"
  // This runner is at its session or memory limit and refused a new session; retryable later.
  | "runner_capacity"
  | "starter_credits_exhausted"
  | "starter_credits_program_paused"
  | "starter_credits_unavailable"
  // The caller's wallet is at its floor, so a turn that would run a platform sandbox was refused
  // before it started. See `metering/sandbox-usage.ts`.
  | "wallet_balance_exhausted"
  | "credential_delivery_failed"
  | "rate_limited"
  // Not a failure: the turn was REFUSED before it started because another turn already owns
  // this session. Nothing ran, nothing was destroyed, and the user's message was never sent.
  // Clients render it as a "not sent, try again" state and keep the text, never as a run error.
  // Produced by `sessions/admission.ts`, not by this module's classifier.
  | "session_turn_in_use"
  // The sandbox died under a running turn: its liveness probe stopped answering, so the turn
  // was ended rather than left holding a machine that no longer exists. See
  // `sandbox-liveness.ts`.
  | "sandbox_gone"
  // The execution never produced an outcome of its own, so one was written for it. Two
  // producers: this runner, when a turn will not unwind after its abort (`sessions/
  // turn-settle.ts`), and the platform's execution watchdog, when the runner itself is gone
  // (`api/oss/src/tasks/asyncio/sessions/orphan_sweep.py`).
  | "execution_lost"
  // The hosted subscription login this run used is dead, and no newer one exists. The user has to
  // sign in again; a retry would fail the same way. See `isSubscriptionAuthFailure`.
  | "subscription_login_required"
  // The login this run used was stale: another session already replaced it. Nothing is wrong with
  // the connection, so this one IS retryable — the next turn picks up the newer login.
  | "subscription_login_refreshed"
  // The run asked for a model the runtime does not know (the in-process Pi session). A setting the
  // user changes; a retry fails the same way.
  | "model_unavailable"
  // The model provider answered the request with an error of its own that no rule above names:
  // a refusal or guardrail returned as an error (Inception: "I'm sorry, but I can't share
  // details of my architecture..."), a content filter, a fault behind a router. The message
  // carries the provider's own sentence, redacted. Not retryable as is: the same request is
  // refused the same way. The failed turn leaves the conversation, so the next message is not.
  | "provider_error"
  // A failure no rule recognized, whose text the runner withholds (it may hold paths, ids or
  // credentials): the message is one sentence with a reference to the runner's log. A client must
  // not show any other text for it in its place (a trace's error text included). Only runs whose
  // unknown text is hidden produce it (`ConciseErrorOptions.unknownText`).
  | "internal_error";

/** One failed run, condensed: the line the user reads plus the class a client can act on. */
export interface ClassifiedRunError {
  message: string;
  code: RunErrorCode;
}

/*
 * Product copy, settled 2026-08-31 for v0.114.4. These strings are the first product copy the
 * runner shows to an end user; every other line here is an operator hint. Keep them short and
 * plain, with no provider or proxy mechanics: the user cannot act on which service refused,
 * only on what to do next. They carry no harness-name prefix, unlike the operator hints,
 * because the reader is the person in the chat.
 */
const STARTER_CREDITS_EXHAUSTED_MESSAGE =
  "Your free Agenta credits are used up. Add your own provider key to keep going.";
const STARTER_CREDITS_PROGRAM_PAUSED_MESSAGE =
  "Free Agenta credits are paused right now. Add your own provider key to continue.";
const RATE_LIMITED_MESSAGE =
  "Too many requests right now. Try again in a moment.";
const PROVIDER_RATE_LIMITED_MESSAGE =
  "Too many requests to the model provider right now. Try again in a moment.";
const STARTER_CREDITS_UNAVAILABLE_MESSAGE =
  "Agenta credits are temporarily unavailable. Try again in a moment.";
export const CREDENTIAL_DELIVERY_FAILED_MESSAGE =
  "A temporary issue kept this run's credentials from reaching the model. Send the message again.";

/*
 * Recognition is matched on the BODY, never on the HTTP status alone: 429 covers admission-time
 * budget refusals, per-key rate limits, and upstream provider quota alike, and telling a user their
 * credits are gone when they were merely throttled is worse than saying nothing.
 */

/** LiteLLM refuses a spent key/team at admission with `budget_exceeded` and this sentence. */
const BUDGET_REFUSAL =
  /budget_exceeded|budget has been exceeded|exceededbudget|crossed spend within budget/i;

/**
 * A budget refusal that names a team/org rather than one key is the program-wide ceiling, not this
 * organization's own allowance — a different situation with different advice.
 */
const TEAM_BUDGET_SUBJECT =
  /\bteam(?:_id)?\s*[=:]|\bteam budget\b|\bexceeded team\b|\bprogram budget\b|\borganization budget\b/i;

/** Throttling from the proxy in front of the model (parallel-request, RPM/TPM, plain rate limit). */
const PROXY_RATE_LIMIT =
  /rate[ _-]?limit|max parallel request|too many requests|\b(?:tpm|rpm)[ _-]?limit/i;

/**
 * The provider refused the request for its size (context window or per-request token cap). Checked
 * after the credit and quota rules and before the rate-limit rule: Groq reports its per-request cap
 * as HTTP 413 with the code `rate_limit_exceeded`, and waiting does not help, the request has to
 * shrink. A bare 413 counts only where it is an HTTP status: at the start of a line (after an
 * optional `Label:`), after `HTTP`, or after `status`/`status_code`. A 413 inside a request id or a
 * duration (`req_ab413cd9`, `after 413s`) is not a status.
 */
const REQUEST_TOO_LARGE =
  /request too large|request entity too large|payload too large|context_length_exceeded|maximum context length|prompt is too long|^(?:[A-Za-z ]+:\s*)?413\b|\bhttp[ /_-]?(?:1\.[01] )?413\b|\bstatus(?:[ _]?code)?[":\s=]+413\b/im;
export const REQUEST_TOO_LARGE_MESSAGE =
  "The request is too large for this model. Start a new session, turn off tools you do not need, or pick a model with a larger context.";

/**
 * A provider's raw HTTP error: a status code followed by its JSON body. The chat shows the body's
 * own reason (its `message`), redacted, not the whole body.
 */
// `400 {json}`, `Label: 400 {json}`, or `OpenAI API error (400): {json}` (Pi's OpenAI provider),
// after any number of `Label: ` prefixes: on `inprocess`, pi-acp reports a failed prompt as an ACP
// internal error, so the text reads `Internal error: OpenAI API error (404): {json}`.
// Each label starts with a letter: a label that could start with a space would let the spaces
// after a colon split two ways, and a long unmatched line would backtrack for minutes.
const RAW_PROVIDER_ERROR = /^(?:[A-Za-z][A-Za-z ]*:\s*)*(?:[A-Za-z ]+\()?([45]\d\d)\b[^\n]*?\{/;

/** The upstream provider's own quota refusal (Vertex/Google shape), distinct from a billing stop. */
const PROVIDER_QUOTA_EXHAUSTED = /resource_exhausted|quota exceeded/i;

/**
 * The provider received the sandbox's opaque credential PLACEHOLDER instead of the real key.
 *
 * On a Daytona run the real model key never enters the sandbox: it is stored as a Daytona Secret
 * and the sandbox holds a `dtn_secret_<id>` placeholder that Daytona substitutes into egress
 * requests to the key's exact host. That substitution propagates asynchronously with no
 * confirmation signal, and when a sandbox's FIRST outbound call beats it (observed live at 10-24s
 * after Secret creation), the raw placeholder reaches the provider and is refused with a 401.
 * The user's key is fine, so the add-a-key advice would be wrong three ways; this is its own
 * transient class. The first alternative matches LiteLLM's refusal of a non-`sk-` bearer
 * ("LiteLLM Virtual Key expected. Received=dtn_****…"); the second matches any provider that
 * echoes the placeholder itself.
 *
 * Both alternatives are SELF-EVIDENCING: each names the placeholder in a shape only the delivery
 * layer produces, so neither needs corroboration. They stay anchored on the literal `dtn_`
 * namespace, Daytona's placeholder prefix, which cannot appear in an `sk-` provider key.
 */
const PLACEHOLDER_CREDENTIAL =
  /virtual key expected.*received=dtn_|dtn_secret_/i;

/**
 * A provider echoing the placeholder MASKED, which the signature above cannot see.
 *
 * OpenAI answers a direct call with "Incorrect API key provided: dtn_secr***************cdef" —
 * the mask truncates before the literal `dtn_secret_`, so without this every direct OpenAI
 * placeholder 401 was blamed on the user's key. It mirrors `MASKED_PLACEHOLDER_ECHO` in
 * `credential-preflight.ts`, and `*` is the only mask character trusted here for the same reason
 * there: a `...`/`…` truncation could equally be a cut-off scrubbed value.
 *
 * WHY IT IS SHAPED THIS TIGHTLY, AND WHY IT NEEDS CORROBORATION. Unlike the two above, this
 * pattern is a guess about formatting rather than a quoted protocol string, so it is the one that
 * can be spoofed by ordinary text. The stem is `{4,}` and the mask `{3,}` so a literal glob like
 * `dtn_*` — a perfectly normal thing to find in a path, a filter, or a log line — cannot match;
 * a real mask is many characters wide. And the caller requires AUTH_REFUSAL alongside it, so a
 * hypothetical customer key spelled `dtn_customer_***` inside an unrelated error is not read as a
 * delivery fault. Corroboration costs nothing here: an unsubstituted placeholder is only ever
 * observed as a credential refusal.
 */
const MASKED_PLACEHOLDER_ECHO = /dtn_[A-Za-z0-9_-]{4,}\*{3,}/i;

/**
 * A refusal of the credential itself, whatever the provider calls it.
 *
 * `401` must stand alone (not digit-adjacent) so it doesn't false-match a bare HTTP status code
 * embedded in an unrelated number — e.g. a `Date.now()`-based path/id that happens to contain
 * "401" as a substring (a real, timestamp-dependent flake this caused).
 */
const AUTH_REFUSAL =
  /authentication required|invalid api key|unauthorized|(?<!\d)401(?!\d)/i;

/**
 * A refusal the PROVIDER answered with 401, as opposed to any authorization failure anywhere.
 *
 * `AUTH_REFUSAL` above is deliberately broad because it decides which advice to print, and bare
 * "unauthorized" appears in plenty of authorization failures that have nothing to do with the
 * model credential — a tool's own API, a mount, a platform call. That breadth is wrong for the
 * fresh-Secret branch, which does two things a display string does not: it spends the session's
 * one credential-race report, and it tells the user to retry. An unrelated "unauthorized" landing
 * inside the propagation window would consume the report and hand out retry guidance for a
 * failure a retry cannot fix, and the genuine race that followed would then get the add-a-key
 * copy. So that branch requires an explicit 401 — the status the provider actually returns when
 * it refuses a credential.
 */
const PROVIDER_401 =
  /(?<!\d)401(?!\d)|status(?:_?code)?[":\s=]+401\b|http[ _-]?401\b/i;

/**
 * A 401 the RUNNER produced, not the model provider.
 *
 * HOW THE 401 IS DETECTED AT ALL, stated plainly because it constrains everything below: this
 * classifier receives one flattened error STRING. It never sees an HTTP response object, so the
 * status it reads is whatever the throwing code chose to write into the message — the runner's own
 * status prefix, not the provider's response. Provenance is therefore prose, and prose has to be
 * excluded by prose.
 *
 * EXACTLY FIVE EMITTERS, and no more. The runner makes five authenticated calls of its own during
 * a turn that can answer 401 and reach this same catch AS CLASSIFIER INPUT: the tool callback
 * (`tool call <ref> failed: HTTP 401`), attachment fetch, attachment claim, session-records query,
 * and session-records persist. Without this exclusion, any one of them landing inside the
 * propagation window would consume the session's single credential-race report and print retry
 * guidance for a failure a retry cannot fix — and the genuine race that followed would then get
 * the add-a-key copy, which is the original bug wearing a disguise.
 *
 * WHY THIS IS SOUND RATHER THAN A GUESS. Each of the five is greppable in `services/runner/src`
 * and prefixed AT ITS THROW SITE precisely so it can be recognized here — four of them threw a
 * bare `HTTP <status>` until this change and were genuinely indistinguishable from a provider
 * refusal. The alternative, plumbing a typed provider-response provenance signal through the
 * harness boundary into `ConciseErrorOptions`, is the right long-term shape and a large change;
 * naming the emitters costs one regex and one word per throw site.
 *
 * WHAT IS DELIBERATELY NOT HERE. Mount, geesefs and otel failures are NOT in this set, for two
 * independent reasons. They never arrive as classifier input: those sites build their message
 * AROUND `conciseError(err, ...)`, so the prefix is added after classification and the classifier
 * only ever sees the inner error. And matching them is actively unsafe — none is a prefixed
 * emitter, so the patterns would have to be loose, and a loose `mount failed` matches inside
 * "the requested amount failed to authorize" or "paramount failed" while a bare `otel` matches
 * inside "hotel-search". Excluding a provider-shaped string is the WORSE direction of this bug:
 * it hands a genuine race the add-a-key copy, which is the failure this whole class exists to
 * prevent. If one ever does prove reachable, re-add it anchored with `\b`.
 *
 * THE STANDING OBLIGATION: a new authenticated call inside the turn must prefix its failure, or it
 * silently rejoins this hazard. That is why the five throw sites carry a comment pointing back.
 */
const RUNNER_INTERNAL_401 =
  /tool call .*failed: HTTP|attachment (?:fetch|claim) failed|session records (?:query|persist) failed/i;

/**
 * How long after a Daytona Secret is delivered a credential refusal is still better explained by
 * propagation than by the key.
 *
 * Daytona's support puts the outer bound at ~30s, our own samples saw healthy substitution in
 * ~2s, and the preflight convicts a stuck sandbox at 10s. The first model call lands after
 * acquire, so the window has to outlast acquire itself; 60s covers that with margin while
 * staying far short of a warm sandbox's later turns, where a 401 really is about the key.
 *
 * ACCEPTED LIMITATION: an unusually slow acquire pushes a GENUINE race past 60s and it gets the
 * add-a-key advice instead. That is the right way round to be wrong. Substitution propagates in
 * 10-24s, so a refusal arriving a full minute after delivery is far more likely a real bad key —
 * exactly the reader the fallback advice serves. The cost when it does misfire is one turn shown
 * the pre-fix copy, on a run whose retry lands on a fresh sandbox anyway.
 */
const CREDENTIAL_PROPAGATION_WINDOW_MS = 60_000;

/**
 * How many times one conversation may be told its credentials did not reach the model.
 *
 * A credential race and a genuinely wrong key look identical on a direct provider: both are a 401
 * with no placeholder echo. The retry copy is the right answer for the race — the failed turn
 * DELETES the sandbox, so the retry lands on a fresh one and the per-sandbox fault is gone — but
 * it is a trap for a bad key, which would be told to retry forever. One report per session bounds
 * that: the second identical failure, on a second fresh sandbox, is far better explained by the
 * key, so it falls through to the ordinary add-a-key advice. A bad key costs exactly one wasted
 * retry; a real race still recovers silently.
 */
export const CREDENTIAL_RACE_REPORTS_PER_SESSION = 1;

/**
 * Whether a credential refusal falls inside the propagation window of a Daytona-delivered key.
 *
 * Exported for the call sites that build the predicate, and so a test can pin the window.
 */
export function withinCredentialPropagationWindow(
  deliveredAt: number | undefined,
  now: number = Date.now(),
): boolean {
  return (
    deliveredAt !== undefined &&
    now - deliveredAt < CREDENTIAL_PROPAGATION_WINDOW_MS
  );
}

/** The proxy answered but cannot reach its own store, or was not reachable at all. */
const PROXY_NO_DATABASE = /no_db_connection/i;
const CONNECTION_FAILURE =
  /econnrefused|connection refused|econnreset|enotfound|eai_again|connection error|502 bad gateway|503 service unavailable/i;
/**
 * A connection failure is only attributable to the credits proxy when the body names it; a bare
 * ECONNREFUSED could be any host the run touched.
 * TODO: once a run knows it is on the funded connection (a flag on the resolved model connection,
 * not yet on the wire), key this off that instead of a body marker and drop the heuristic.
 */
const PROXY_MARKER = /litellm|budget_exceeded|no_db_connection/i;

export interface ConciseErrorOptions {
  /**
   * What an error no rule recognizes shows. `sanitized` (the default): its first line, redacted.
   * `hidden`: one generic sentence with a reference, the text only in the runner's log. The
   * `inprocess` provider asks for `hidden`; `local` and `daytona` keep `sanitized` until every
   * runner-authored sentence they surface carries a public code.
   */
  unknownText?: "sanitized" | "hidden";
  /**
   * Called only when the error maps to the model-authentication branch. A run that authenticates
   * from a mounted subscription login rather than a vault key can diagnose the real fault there
   * (see `describeCodexSubscriptionAuthFault`); returning a string replaces the generic
   * add-a-key line, which would otherwise send the operator after a key the run never uses.
   * Lazy so the check (a stat) only runs on the error path it explains.
   */
  authFault?: () => string | undefined;
  /**
   * The run's named connection (wire `connection.slug`) and resolved deployment
   * (`modelConnection.deployment`), when the caller knows them. A custom deployment carries the
   * provider family "openai" for its DIALECT, so without this the auth hint names a key the
   * user never configured; with it, the hint names the connection the key lives on.
   */
  connection?: { slug?: string; deployment?: string };
  /**
   * Whether this run's MODEL credential rode a Daytona Secret delivered recently enough that
   * substitution may not have propagated. Lazy, like `authFault`: only the refusal path asks.
   *
   * This is the ONLY signal available on a direct provider. The body-echo signature above sees
   * the race only when the provider names the placeholder it received, which the credits proxy
   * does ("Received=dtn_****") and a direct endpoint does not — api.anthropic.com answers a
   * bad bearer with "Invalid bearer token" and no echo at all, and a masked OpenAI echo
   * ("dtn_secr*****") no longer contains the literal `dtn_secret_` the signature looks for.
   * Without this option every direct-path placeholder 401 is blamed on the user's key.
   */
  daytonaCredentialFresh?: () => boolean;
}

/**
 * Turn a harness/SDK error into one clear line for the caller instead of dumping a full
 * ACP/JS stack, plus the stable class a client can render a state for. Recognizes common harness
 * auth failures and the admission-time refusals of a budgeted model proxy.
 *
 * `provider` is the resolved provider for the run; pass it so the credit/auth hint names the
 * actual provider the run targeted, not a provider guessed from the harness name.
 */
export function classifyRunError(
  err: unknown,
  harness: string,
  provider?: string,
  options: ConciseErrorOptions = {},
): ClassifiedRunError {
  // An error that states its own public code was written for the person in the chat.
  if (isPublicError(err)) return { message: sanitizeErrorText(err.message), code: err.publicCode };
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.split("\n")[0].trim();
  const keyHint = keyHintFor(provider, harness, options.connection);
  // FIRST, and matched on the ERROR CLASS rather than on any text. Every sandbox this run built
  // was convicted by the credential preflight, which means the model key never reached the model:
  // the same failure class as the two placeholder branches below, arrived at by proof instead of
  // by pattern. Its own message names probes and placeholders and is written for the runner log,
  // so it must not be what the person in the chat reads. See `credential-preflight.ts`.
  if (err instanceof SubstitutionStuckError) {
    return {
      message: CREDENTIAL_DELIVERY_FAILED_MESSAGE,
      code: "credential_delivery_failed",
    };
  }
  // First, and self-evidencing: this marker is produced by our own liveness probe and by
  // nothing else, so it needs no corroboration and must not be re-read as a provider fault.
  if (raw.includes(SANDBOX_GONE_MARKER)) {
    return { message: SANDBOX_GONE_MESSAGE, code: "sandbox_gone" };
  }
  if (raw.includes(ABANDONED_TURN_MARKER)) {
    return { message: EXECUTION_LOST_MESSAGE, code: "execution_lost" };
  }
  // A budget refusal is checked first: it is the most specific reading of a 429, and its body also
  // trips the rate-limit and quota matchers below.
  if (BUDGET_REFUSAL.test(raw)) {
    // The user-visible line is a constant, so the refusal body — which names the key and its spend
    // — never reaches the chat.
    return TEAM_BUDGET_SUBJECT.test(raw)
      ? {
          message: STARTER_CREDITS_PROGRAM_PAUSED_MESSAGE,
          code: "starter_credits_program_paused",
        }
      : {
          message: STARTER_CREDITS_EXHAUSTED_MESSAGE,
          code: "starter_credits_exhausted",
        };
  }
  if (
    PROXY_NO_DATABASE.test(raw) ||
    (CONNECTION_FAILURE.test(raw) && PROXY_MARKER.test(raw))
  ) {
    return {
      message: STARTER_CREDITS_UNAVAILABLE_MESSAGE,
      code: "starter_credits_unavailable",
    };
  }
  if (
    /credit balance is too low|exceeded your current quota|insufficient_quota|insufficient credits/i.test(
      raw,
    )
  ) {
    return {
      message: `${harness}: the model provider account has insufficient credit (check ${keyHint}).`,
      code: "runner_error",
    };
  }
  // After the billing branch above: OpenAI reports an unpaid account as a RateLimitError whose body
  // says "exceeded your current quota", and that is a billing stop, not throttling.
  if (PROVIDER_QUOTA_EXHAUSTED.test(raw)) {
    return { message: PROVIDER_RATE_LIMITED_MESSAGE, code: "rate_limited" };
  }
  if (REQUEST_TOO_LARGE.test(raw)) {
    return { message: REQUEST_TOO_LARGE_MESSAGE, code: "runner_error" };
  }
  if (PROXY_RATE_LIMIT.test(raw)) {
    return { message: RATE_LIMITED_MESSAGE, code: "rate_limited" };
  }
  // Before the generic auth branch: a placeholder-shaped refusal IS a 401, but its cause is
  // credential delivery, not the user's key, and the add-a-key advice would be false.
  //
  // `PLACEHOLDER_CREDENTIAL` is self-evidencing and stands alone: it quotes a protocol string only
  // the delivery layer produces. `MASKED_PLACEHOLDER_ECHO` is NOT — it is a guess about formatting,
  // so it is corroborated by `AUTH_REFUSAL` and only the pair of them together is evidence.
  //
  // DELIBERATELY NOT SUBJECT TO THE PER-SESSION REPORT BUDGET, unlike the branch below. That
  // budget exists because a bare 401 cannot distinguish a delivery race from a genuinely wrong
  // key, so the honest-retry reading has to be spent sparingly. A body that ECHOES the placeholder
  // carries its own proof: a real user key never contains `dtn_`, so every such refusal IS a
  // delivery failure, however many times it happens. Capping it would eventually tell a user with
  // a perfectly good key to go add one — the exact wrong answer this class exists to prevent.
  if (
    PLACEHOLDER_CREDENTIAL.test(raw) ||
    (MASKED_PLACEHOLDER_ECHO.test(raw) && AUTH_REFUSAL.test(raw))
  ) {
    return {
      message: CREDENTIAL_DELIVERY_FAILED_MESSAGE,
      code: "credential_delivery_failed",
    };
  }
  // Still before the generic auth branch, and the direct-provider half of the case above: the
  // refusal carries no placeholder because the provider does not echo what it received, so the
  // only evidence is that this run's key WAS a Daytona Secret delivered moments ago. Same class,
  // same honest copy — the alternative is telling a user with a valid key to add one.
  //
  // `PROVIDER_401`, not `AUTH_REFUSAL`: this branch spends the session's one report and prints
  // retry guidance, so it must not fire for an authorization failure that merely says
  // "unauthorized" somewhere unrelated. See the note on `PROVIDER_401`.
  //
  // And not a 401 the RUNNER itself produced. A tool call, an attachment fetch, or a
  // session-records query can answer 401 inside the same window and reach this same catch; the
  // status in the string is the runner's own prefix, not the provider's response, so the only way
  // to tell them apart is to name them. See `RUNNER_INTERNAL_401`.
  if (
    PROVIDER_401.test(raw) &&
    !RUNNER_INTERNAL_401.test(raw) &&
    options.daytonaCredentialFresh?.()
  ) {
    return {
      message: CREDENTIAL_DELIVERY_FAILED_MESSAGE,
      code: "credential_delivery_failed",
    };
  }
  if (AUTH_REFUSAL.test(raw)) {
    return {
      message:
        options.authFault?.() ??
        `${harness}: model authentication failed — add ${keyHint} to the project vault, or log in (OAuth).`,
      code: "runner_error",
    };
  }
  if (
    /invalid_request_error/i.test(raw) &&
    /(could not process image|unable to process image|invalid image|image.*(corrupt|invalid|could not))/i.test(
      raw,
    )
  ) {
    return {
      message: `${harness}: the attached image appears to be corrupted or incomplete — try re-attaching it.`,
      code: "runner_error",
    };
  }
  if (
    /\b(?:WebSocket (?:error|closed|connect timeout|idle timeout|stream closed)|connection error|fetch failed)\b/i.test(
      raw,
    )
  ) {
    return {
      message:
        "The agent lost its connection while working and could not recover. You can continue from here.",
      code: "runner_error",
    };
  }
  if (SANDBOX_PROVIDER_CAPACITY.test(raw)) {
    return { message: SANDBOX_CAPACITY_MESSAGE, code: "sandbox_capacity" };
  }
  const providerError = describeProviderError(raw);
  if (providerError) return { message: providerError, code: "provider_error" };
  const rawProviderError = describeRawProviderError(msg);
  if (rawProviderError) return rawProviderError;
  if (options.unknownText !== "hidden") return { message: sanitizeErrorText(msg) || "agent run failed", code: "runner_error" };
  // Unknown text is not shown: it can carry paths, ids or credentials no rule anticipated. The
  // reference joins the sentence to the log line holding the error, redacted and cut to 500
  // characters (the log is not a place for credentials either).
  const reference = randomBytes(4).toString("hex");
  process.stderr.write(`[errors] unclassified run error reference=${reference}: ${sanitizeErrorText(raw).slice(0, 500)}\n`);
  return { message: unclassifiedRunErrorMessage(reference), code: "internal_error" };
}

/**
 * A router's report of the upstream provider's own error. OpenRouter writes
 * "Upstream error from <Provider>: <the provider's message>"; the provider's message is often a
 * refusal worded for the end user. "Provider returned error" is its wording when it has no text.
 */
const UPSTREAM_PROVIDER_ERROR = /upstream error from ([A-Za-z0-9][A-Za-z0-9 ._-]{0,40}?)\s*:\s*([^\n]+)/i;
const PROVIDER_RETURNED_ERROR = /\bprovider returned error\b/i;
/** A provider's content filter or moderation refusal, named in its own error. */
const CONTENT_FILTER = /content[_ ]filter|content management policy|flagged by (?:the )?moderation|responsible ?ai polic/i;
const PROVIDER_TEXT_MAX_CHARS = 300;

/** The part of a failed turn the person can act on: the rest of the conversation is unaffected. */
const PROVIDER_ERROR_ADVICE =
  "You can keep going in this conversation. Sending the same request again will likely fail the same way: rephrase it or pick another model.";

/** A provider's own words, redacted and cut, ending with a full stop. */
function providerSentence(text: string): string | undefined {
  const said = sanitizeErrorText(text.trim()).slice(0, PROVIDER_TEXT_MAX_CHARS).trim();
  if (!said) return undefined;
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

/** The `message` of a provider's JSON error body (`{"error":{"message":...}}` or `{"message":...}`). */
function providerBodyReason(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const error = parsed?.error;
    const message =
      error && typeof error === "object" ? (error as { message?: unknown }).message : (error ?? parsed?.message);
    if (typeof message === "string") return message;
  } catch {
    // Not one JSON value (cut off, or followed by more text): read the first "message" string.
  }
  const quoted = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1];
  if (quoted === undefined) return undefined;
  try {
    return JSON.parse(`"${quoted}"`) as string;
  } catch {
    return quoted;
  }
}

/**
 * A raw `NNN {json}` provider error as one sentence with the provider's own reason, redacted. A
 * 4xx is a refusal of this request (`provider_error`); a 429 or a 5xx is the provider busy or
 * failing, which a retry may fix.
 */
function describeRawProviderError(line: string): ClassifiedRunError | undefined {
  const match = RAW_PROVIDER_ERROR.exec(line);
  if (!match) return undefined;
  const status = match[1]!;
  const reason = providerBodyReason(line.slice(line.indexOf("{", match.index)));
  const said = reason === undefined ? undefined : providerSentence(reason);
  if (status === "429" || status.startsWith("5")) {
    return {
      message: `The model provider could not answer (HTTP ${status})${said ? `: ${said}` : "."} Try again in a moment.`,
      code: "runner_error",
    };
  }
  return {
    message: `The model provider refused the request (HTTP ${status})${said ? `: ${said}` : "."} ${PROVIDER_ERROR_ADVICE}`,
    code: "provider_error",
  };
}

/** One readable sentence for a provider-side error, or undefined when `raw` is not one. */
function describeProviderError(raw: string): string | undefined {
  const upstream = UPSTREAM_PROVIDER_ERROR.exec(raw);
  if (upstream) {
    const provider = upstream[1]!.trim();
    const said = providerSentence(upstream[2]!);
    if (said) return `The model provider (${provider}) returned an error: ${said} ${PROVIDER_ERROR_ADVICE}`;
    return `The model provider (${provider}) returned an error. ${PROVIDER_ERROR_ADVICE}`;
  }
  if (CONTENT_FILTER.test(raw)) {
    return `The model provider's content filter blocked this request. ${PROVIDER_ERROR_ADVICE}`;
  }
  if (PROVIDER_RETURNED_ERROR.test(raw)) {
    return `The model provider returned an error for this request. ${PROVIDER_ERROR_ADVICE}`;
  }
  return undefined;
}

/** The one sentence for an error no rule recognizes. */
export function unclassifiedRunErrorMessage(reference: string): string {
  return `The agent run failed (reference ${reference}). Send the message again; if it fails again, the reference points to the error in the agent service's log.`;
}

/**
 * The public error contract: an error carrying `publicCode` has a message written for the person
 * in the chat (a readable sentence, no internal ids or paths), and `classifyRunError` passes both
 * through, redacted once more. Anything else is mapped to a known sentence by its class. What no
 * rule recognizes is, for `inprocess`, one generic sentence with a reference (its text only in the
 * log); for `local` and `daytona`, its redacted first line (`ConciseErrorOptions.unknownText`).
 */
export interface PublicError extends Error {
  publicCode: RunErrorCode;
}

export function isPublicError(err: unknown): err is PublicError {
  return err instanceof Error && typeof (err as Partial<PublicError>).publicCode === "string";
}

/** Give `err` a public code, keeping its (already readable) message. */
export function withPublicCode<E extends Error>(err: E, code: RunErrorCode): E & PublicError {
  return Object.assign(err, { publicCode: code });
}

/**
 * The sandbox provider refused for capacity or quota (Daytona: "Total disk limit exceeded",
 * "concurrency limit", "upgrade your organization's Tier"). Its text sells an upgrade and links a
 * vendor dashboard; the person reads a plain sentence instead.
 */
export const SANDBOX_PROVIDER_CAPACITY =
  /total (?:disk|cpu|memory) limit exceeded|(?:disk|cpu|memory|concurrency|sandbox) (?:quota|limit) (?:exceeded|reached)|upgrade your organization'?s tier/i;
export const SANDBOX_CAPACITY_MESSAGE =
  "The command sandbox could not be started because the sandbox provider is at its capacity limit. Try again in a few minutes.";

/**
 * Credentials redacted from a sentence, and nothing else: `Bearer`/`Basic` values and any other
 * `Authorization` scheme's, the value of a field named like a key, token, secret, password or
 * credential (quoted or not, singular or plural, except `tokens`, which names counts), JWTs and
 * provider-key shapes (`sk-...`). Numbers, ids and paths stay: `max_tokens: 4096`, a sandbox id in
 * a log line and a file name in an `ENOENT` are what a reader needs. Applied to the runner's own
 * public sentences, to a provider's quoted reason, to an unclassified error's first line and to
 * what the runner logs about it. The web applies the same rules (`turnStatus.ts`) to what reaches
 * it from any source, such as a trace.
 */
export function sanitizeErrorText(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [secret]")
    .replace(/\b(Token|Bot)\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/g, "$1 [secret]")
    // Any other scheme in an Authorization header, quoted or not (`Authorization: Token abc...`,
    // `{"Authorization": "Token abc..."}`).
    .replace(/\b(Authorization['"]?\s*[=:]\s*['"]?)(?!(?:Bearer|Basic)\b)([A-Za-z]+)\s+(?!\[secret\])[A-Za-z0-9._~+/=-]{6,}/gi, "$1$2 [secret]")
    // A credential's value, quoted (`password='a b'`, `"token": "x"`) or not (`key=x`), digits
    // included. The name ends in the credential word, so `max_tokens` or `input_tokens` is not one.
    .replace(/(['"]?)\b([A-Za-z0-9_-]*(?:keys?|token|secrets?|passwords?|passwd|credentials?))\1\s*[=:]\s*(['"`])(?:(?!\3)[^\\]|\\.)*\3/gi, "$2=[secret]")
    .replace(/(['"]?)\b([A-Za-z0-9_-]*(?:keys?|token|secrets?|passwords?|passwd|credentials?))\1\s*[=:]\s*(?!\[secret\])['"`]?[^\s'"`,;)]+/gi, "$2=[secret]")
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]+/g, "[secret]")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[secret]")
    .trim();
}

/*
 * Hosted subscription auth. Product copy, and the one pattern that recognizes it.
 *
 * The reader is the person in the chat, and they own the connection, so the copy names the action
 * and the place. It carries no provider mechanics, no token, and no path — the same rule as the
 * starter-credits copy above.
 */
export const SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE =
  "The ChatGPT sign-in is no longer valid. Sign in again from AI providers.";
/**
 * The login this turn started on is gone and a live one has taken its place — refreshed by this
 * run, or signed in again elsewhere. The running harness cannot pick it up (see
 * `SubscriptionRecovery`), so the copy asks for the message again rather than for a sign-in.
 */
export const SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE =
  "The ChatGPT sign-in was renewed. Send your message again.";
/**
 * The provider could not be reached to judge the login, so nothing is known about it and nothing
 * was marked. Distinct copy from the two above, and deliberately NOT "sign in again": the
 * connection may be perfectly good, and sending the user through a device login to fix a network
 * blip would spend a sign-in for nothing (contract amendment A2).
 */
export const SUBSCRIPTION_LOGIN_UNCHECKED_MESSAGE =
  "The ChatGPT sign-in could not be checked. Try again.";

/**
 * Pi's own words for a login it cannot use.
 *
 * Pi exposes no error taxonomy: every failure is a plain `Error` carrying a formatted string, so
 * the classification is by string and there is nothing better to key on (research/pi-auth.md
 * section 7). Every alternative below is read out of the SHIPPED bundle
 * (`@earendil-works/pi-ai` and `pi-coding-agent` 0.80.6), never from the design notes:
 *
 * - `Authentication failed` / `Authentication failed for <provider>` — the credential is unusable.
 * - `Failed to refresh OAuth token for <providerId>` — the refresh was rejected and its cause was
 *   discarded, so this is what most callers actually see.
 * - `No API key found for <providerDisplay>`, `No API key for provider: <provider>`, and
 *   `No API key for <provider>/<model>` — three DIFFERENT sentences for "there is no credential at
 *   all", one of which interpolates a display NAME rather than the provider id. A hosted run that
 *   sees any of them had its materialized login fail to reach the harness.
 * - `Failed to extract accountId from token` — the stored access token is not a readable JWT, so
 *   the login on disk is corrupt.
 *
 * The last alternative is not Pi's at all. `Could not parse your authentication token. Please try
 * signing in again.` is the PROVIDER's own prose, relayed through Pi. Provider prose is the most
 * fragile input here, so it is matched on the two nouns that carry the meaning rather than on the
 * whole sentence.
 *
 * The provider id is deliberately NOT required: several of these sentences do not carry it, and
 * requiring it leaves a dead sign-in unclassified. The breadth is safe because this pattern is
 * consulted ONLY for a run that carries a subscription: such a run has no vault key, so "no API
 * key" can only be about the login.
 */
const PI_SUBSCRIPTION_AUTH_FAILURE =
  /authentication failed|failed to refresh oauth token|no api key|failed to extract accountid from token|authentication token|sign(?:ing)? in again/i;

/**
 * Whether this failure means the run's hosted subscription login was refused.
 *
 * Call it ONLY for a run that carries a subscription. The bare-401 half is `AUTH_REFUSAL` minus the
 * runner's own five internal emitters: a subscription run has no vault key, so a credential refusal
 * on it is about the login by elimination — but a 401 the RUNNER produced (a tool callback, an
 * attachment fetch, a session-records call) is not a provider refusal at all, and reporting one as
 * a dead sign-in would tell the user to re-authenticate a connection that is fine.
 */
export function isSubscriptionAuthFailure(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  if (RUNNER_INTERNAL_401.test(raw)) return false;
  return PI_SUBSCRIPTION_AUTH_FAILURE.test(raw) || AUTH_REFUSAL.test(raw);
}

/**
 * A short word for WHY the login was refused, for the failure report the API records.
 *
 * A closed set of six, never the harness's own sentence: that sentence can quote the request, and
 * this value is stored on the connection row and shown to the user as `login_error`.
 */
export function subscriptionAuthFailureReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/failed to refresh oauth token/i.test(raw)) return "refresh_rejected";
  if (/no api key/i.test(raw)) return "login_missing";
  if (/failed to extract accountid from token/i.test(raw)) {
    return "login_unreadable";
  }
  if (/authentication token|sign(?:ing)? in again/i.test(raw)) {
    return "token_rejected";
  }
  if (/authentication failed/i.test(raw)) return "auth_failed";
  return "unauthorized";
}

/** The classified error for a subscription auth failure, given the API's `stale` answer. */
export function subscriptionAuthError(stale: boolean): ClassifiedRunError {
  return stale
    ? {
        message: SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
        code: "subscription_login_refreshed",
      }
    : {
        message: SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE,
        code: "subscription_login_required",
      };
}

/** The human line of {@link classifyRunError}, for the log/diagnostic call sites that want only it. */
export function conciseError(
  err: unknown,
  harness: string,
  provider?: string,
  options: ConciseErrorOptions = {},
): string {
  return classifyRunError(err, harness, provider, options).message;
}

/** The line a person reads when the runner ended a turn that would not finish on its own. */
export function abandonedTurnMessage(reason: string, harness: string): string {
  if (reason === RUNNER_SHUTDOWN_REASON) return RUNNER_RESTARTING_MESSAGE;
  return classifyRunError(new Error(`${ABANDONED_TURN_MARKER}: ${reason}`), harness).message;
}
