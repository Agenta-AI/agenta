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
export type RunErrorCode =
  | "runner_error"
  | "starter_credits_exhausted"
  | "starter_credits_program_paused"
  | "starter_credits_unavailable"
  | "credential_delivery_failed"
  | "rate_limited";

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
const CREDENTIAL_DELIVERY_FAILED_MESSAGE =
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
 * The runner makes several authenticated calls of its own during a turn that can answer 401 and
 * reach the same catch: the tool callback (`tool call <ref> failed: HTTP 401`), attachment fetch
 * and claim, and the session-records query and persist. Without this exclusion, any one of them
 * landing inside the propagation window would consume the session's single credential-race report
 * and print retry guidance for a failure a retry cannot fix — and the genuine race that followed
 * would then get the add-a-key copy, which is the original bug wearing a disguise.
 *
 * WHY THIS IS SOUND RATHER THAN A GUESS. Every emitter above is greppable in `services/runner/src`
 * and prefixed at its throw site precisely so it can be recognized here. Three of them threw a
 * BARE `HTTP <status>` until this change and were genuinely indistinguishable from a provider
 * refusal; they now carry a name. The alternative — plumbing a typed provider-response provenance
 * signal through the harness boundary into `ConciseErrorOptions` — is the right long-term shape
 * and a large change; naming the emitters costs one regex and one word per throw site.
 *
 * THE STANDING OBLIGATION: a new authenticated call inside the turn must prefix its failure, or it
 * silently rejoins this hazard. That is why the throw sites carry a comment pointing back here.
 */
const RUNNER_INTERNAL_401 =
  /tool call .*failed: HTTP|attachment (?:fetch|claim) failed|session records (?:query|persist) failed|(?:re)?mount(?:point)? (?:failed|cleanup failed)|geesefs|otel/i;

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
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.split("\n")[0].trim();
  const keyHint = keyHintFor(provider, harness, options.connection);
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
    /credit balance is too low|exceeded your current quota|insufficient_quota/i.test(
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
  return { message: msg || "agent run failed", code: "runner_error" };
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
