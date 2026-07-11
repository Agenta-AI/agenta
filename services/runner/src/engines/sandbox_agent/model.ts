type Log = (message: string) => void;

/**
 * A requested model that the harness cannot set, after the suffix-resolution retry. Carries the
 * requested id and the valid options so the caller sees exactly what it asked for and what the
 * harness would accept, instead of the run silently proceeding on a different (often pricier)
 * default. This is the fail-loud half of F-007.
 */
export class ModelNotSettableError extends Error {
  readonly requested: string;
  readonly allowed: string[];

  constructor(requested: string, allowed: string[], cause: string) {
    const options = allowed.length
      ? allowed.join(", ")
      : "none reported by the harness config options";
    super(
      `model '${requested}' is not available on this run (${cause}). ` +
        `Valid models for this harness: ${options}.`,
    );
    this.name = "ModelNotSettableError";
    this.requested = requested;
    this.allowed = allowed;
  }
}

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
    // pi-acp builds each choice as `{ value: model.modelId, name, description }` and sandbox-agent
    // reads `entry.value`; older shapes used `id`. Read `value` first so this returns the real
    // selectable ids (reading only `id` silently returned [] for pi-acp).
    return choices.map((c: any) => c.value ?? c.id).filter(Boolean);
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
 * Apply the requested model to a session, normalizing to the harness's own id.
 *
 * No model requested keeps the harness default (returns undefined) — that is not an error.
 * A requested model is first tried verbatim, then resolved against the harness's own ids via
 * `pickModel` (so a bare "gpt-5.5" reaches Pi's "openai-codex/gpt-5.5"). When nothing resolves,
 * the outcome depends on `strict` (default true): strict throws a `ModelNotSettableError` naming
 * the requested id and the valid options, so a user who picks a model either gets it or sees a
 * loud failure; non-strict logs one line and keeps the harness default (the legacy opt-out for
 * `AGENTA_AGENT_MODEL_STRICT=false`). This is the F-007 fix.
 */
export async function applyModel(
  session: any,
  wanted?: string,
  log: Log = () => {},
  options: { strict?: boolean } = {},
): Promise<string | undefined> {
  if (!wanted) return undefined;
  const strict = options.strict ?? true;
  try {
    await session.setModel(wanted);
    return wanted;
  } catch (err) {
    // The harness rejected the exact id. Resolve it against the harness's own selectable ids
    // (Pi exposes "openai-codex/gpt-5.5"; a caller passes a bare "gpt-5.5") and retry once.
    const allowed = allowedFromError(err);
    const fallbackAllowed = allowed.length ? allowed : await allowedModels(session);
    const match = pickModel(fallbackAllowed, wanted);
    if (match && match !== wanted) {
      try {
        await session.setModel(match);
        return match;
      } catch {
        // even the resolved id failed; fall through to the strict/lenient terminal handling
      }
    }
    if (strict) {
      throw new ModelNotSettableError(wanted, fallbackAllowed, (err as Error).message);
    }
    log(`model '${wanted}' not settable (${(err as Error).message}); using harness default`);
    return undefined;
  }
}
