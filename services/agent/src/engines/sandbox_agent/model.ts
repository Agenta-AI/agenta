type Log = (message: string) => void;

/**
 * Pick the harness-specific model id for a requested name. Harnesses expose their own ids
 * (Pi: "openai-codex/gpt-5.5"; Claude: its own). Match exact, then by provider suffix.
 */
export function pickModel(allowed: string[], wanted?: string): string | undefined {
  if (!wanted) return undefined;
  if (allowed.includes(wanted)) return wanted;
  const suffix = (id: string) => id.slice(id.indexOf("/") + 1);
  return (
    allowed.find((id) => suffix(id) === wanted) ??
    allowed.find((id) => suffix(id) === suffix(wanted)) ??
    undefined
  );
}

/** Enumerate the harness's selectable model ids from the session config options. */
export async function allowedModels(session: any): Promise<string[]> {
  try {
    const options = await session.getConfigOptions();
    const modelOpt = (options ?? []).find(
      (o: any) => o.category === "model" || o.id === "model",
    );
    const choices = modelOpt?.options ?? [];
    return choices.map((c: any) => c.id).filter(Boolean);
  } catch {
    return [];
  }
}

/** Parse the allowed model ids out of an UnsupportedSessionValueError message. */
export function allowedFromError(err: unknown): string[] {
  const match = /Allowed values:\s*(.+?)\s*$/.exec(String((err as Error)?.message ?? err));
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Apply the requested model to a session, normalizing to the harness's own id. Returns the
 * id set, or undefined when no match exists and the harness keeps its default.
 */
export async function applyModel(
  session: any,
  wanted?: string,
  log: Log = () => {},
  options: { strict?: boolean } = {},
): Promise<string | undefined> {
  if (!wanted) return undefined;
  try {
    await session.setModel(wanted);
    return wanted;
  } catch (err) {
    if (options.strict) {
      throw new Error(`model '${wanted}' not settable (${(err as Error).message})`);
    }
    const allowed = allowedFromError(err);
    const fallbackAllowed = allowed.length ? allowed : await allowedModels(session);
    const match = pickModel(fallbackAllowed, wanted);
    if (match && match !== wanted) {
      try {
        await session.setModel(match);
        return match;
      } catch {
        // fall through to harness default
      }
    }
    log(`model '${wanted}' not settable (${(err as Error).message}); using harness default`);
    return undefined;
  }
}
