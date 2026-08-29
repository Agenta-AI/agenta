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
  if (connection?.deployment === "custom" && connection.slug) {
    return `the '${connection.slug}' connection's API key`;
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
 * TODO(copy: owner) — the product-copy strings below are PLACEHOLDERS. They are the first product
 * copy the runner puts in front of an end user (every other line here is an operator hint), so the
 * final wording is the product owner's to write. Keep them short, plain, and free of provider/proxy
 * mechanics: the user cannot act on which service refused, only on what to do next.
 *
 * They are deliberately NOT prefixed with the harness name the way the operator hints are — the
 * reader of these is the person chatting, to whom "claude:" is noise.
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
 */
const PLACEHOLDER_CREDENTIAL =
  /virtual key expected.*received=dtn_|dtn_secret_/i;

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
  if (PLACEHOLDER_CREDENTIAL.test(raw)) {
    return {
      message: CREDENTIAL_DELIVERY_FAILED_MESSAGE,
      code: "credential_delivery_failed",
    };
  }
  // `401` must stand alone (not digit-adjacent) so it doesn't false-match a bare HTTP status
  // code embedded in an unrelated number — e.g. a `Date.now()`-based path/id that happens to
  // contain "401" as a substring (a real, timestamp-dependent flake this caused).
  if (
    /authentication required|invalid api key|unauthorized/i.test(raw) ||
    /(?<!\d)401(?!\d)/.test(raw)
  ) {
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
