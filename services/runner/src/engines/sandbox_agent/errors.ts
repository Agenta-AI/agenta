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
 * `provider` is the resolved provider the runner already knows (`request.provider`, from the
 * resolved connection). When it is absent (un-migrated caller) fall back to the harness default
 * — Claude is always Anthropic; every other harness defaults to OpenAI, matching the old
 * behavior for that path only.
 */
function keyHintFor(provider: string | undefined, harness: string): string {
  const label = provider ? PROVIDER_KEY_LABELS[provider.toLowerCase()] : undefined;
  if (label) return `the project's ${label} key`;
  if (harness === "claude") return "the project's Anthropic key";
  return "the project's OpenAI key";
}

/**
 * Turn a harness/SDK error into one clear line for the caller instead of dumping a full
 * ACP/JS stack. Recognizes common harness auth failures.
 *
 * `provider` is the resolved provider for the run; pass it so the credit/auth hint names the
 * actual provider the run targeted, not a provider guessed from the harness name.
 */
export function conciseError(
  err: unknown,
  harness: string,
  provider?: string,
): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.split("\n")[0].trim();
  const keyHint = keyHintFor(provider, harness);
  if (/credit balance is too low|exceeded your current quota|insufficient_quota/i.test(raw)) {
    return `${harness}: the model provider account has insufficient credit (check ${keyHint}).`;
  }
  if (/authentication required|invalid api key|401|unauthorized/i.test(raw)) {
    return `${harness}: model authentication failed — add ${keyHint} to the project vault, or log in (OAuth).`;
  }
  return msg || "agent run failed";
}
