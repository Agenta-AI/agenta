/**
 * Turn a harness/SDK error into one clear line for the caller instead of dumping a full
 * ACP/JS stack. Recognizes common harness auth failures.
 */
export function conciseError(err: unknown, harness: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.split("\n")[0].trim();
  const keyHint =
    harness === "claude" ? "the project's Anthropic key" : "the project's OpenAI key";
  if (/credit balance is too low/i.test(raw)) {
    return `${harness}: the model provider account has insufficient credit (check ${keyHint}).`;
  }
  if (/authentication required|invalid api key|401|unauthorized/i.test(raw)) {
    return `${harness}: model authentication failed — add ${keyHint} to the project vault, or log in (OAuth).`;
  }
  return msg || "agent run failed";
}
