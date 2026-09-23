import type { AgentRunRequest } from "../../protocol.ts";
import { harnessKindOf } from "../../harness-kind.ts";

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
 * Strip a trailing Claude-style context-window hint (e.g. "sonnet[1m]" -> "sonnet") so a bare
 * alias can be matched against the harness's own id regardless of which context variant the
 * harness currently exposes for that model family.
 */
const stripContextHint = (id: string) => id.replace(/\[[^[\]]*\]$/, "");

/**
 * Retired model ids the harness no longer offers, mapped to the successor a saved config should
 * run on instead. Claude Code 2.1.280 dropped `claude-fable-5` and moves its own saved setting to
 * Fable 5.1; saved agent configs get the same treatment so they keep running. Consulted only
 * after the requested id failed to match, so a harness that still offers the old id keeps it.
 */
const RETIRED_MODEL_SUCCESSORS: Record<string, string> = {
  "claude-fable-5": "claude-fable-5-1",
};

/**
 * The successor for a retired id, in any spelling a saved config may hold: bare,
 * provider-prefixed (`anthropic/claude-fable-5`) or context-hinted (`claude-fable-5[1m]`). The
 * successor is returned bare; `pickModel` then widens it to the hinted option when that is the
 * only variant on offer.
 */
const baseModelId = (id: string) => stripContextHint(id.slice(id.indexOf("/") + 1));

const retiredModelSuccessor = (id: string): string | undefined =>
  RETIRED_MODEL_SUCCESSORS[baseModelId(id)];

/**
 * Model-id prefixes mapped to the tier alias the Claude harness names them by. Claude Code
 * selects by tier alias, and which concrete ids a build also accepts depends on the account: an
 * API-key session of the pinned build offers `opus[1m]` but not `claude-opus-5-5`, while a
 * subscription session accepts it. A concrete id the build does not offer runs on its tier alias
 * rather than failing. Mirrors the tier entries of the SDK's `MODEL_ID_ALIASES`
 * (sdks/python/agenta/sdk/agents/capabilities.py), which a unit test holds equal.
 */
export const CLAUDE_TIER_ALIASES: Record<string, string> = {
  "claude-opus-": "opus",
  "claude-sonnet-": "sonnet",
  "claude-haiku-": "haiku",
};

const contextHint = (id: string) => /\[[^[\]]*\]$/.exec(id)?.[0] ?? "";

const claudeTierAlias = (id: string): string | undefined => {
  const base = baseModelId(id);
  const prefix = Object.keys(CLAUDE_TIER_ALIASES).find((p) => base.startsWith(p));
  return prefix ? CLAUDE_TIER_ALIASES[prefix] : undefined;
};

/**
 * The tier option the harness offers for a concrete Claude id: the same context variant as the
 * request when offered, else the bare alias, else its widened `[1m]` option. Matches only the
 * harness's own alias ids, never a provider-prefixed Pi id.
 */
const pickTierAlias = (allowed: string[], wanted: string): string | undefined => {
  const tier = claudeTierAlias(wanted);
  if (!tier) return undefined;
  const hint = contextHint(wanted);
  if (hint && allowed.includes(tier + hint)) return tier + hint;
  if (allowed.includes(tier)) return tier;
  return allowed.find((id) => stripContextHint(id) === tier);
};

/**
 * Pick the harness-specific model id for a requested name. Harnesses expose their own ids
 * (Pi: "openai-codex/gpt-5.5"; Claude: alias ids like "opus" / "sonnet[1m]"). Match exact, then
 * by provider suffix (Pi), then by context-hint-normalized alias (Claude).
 *
 * The context-hint tier exists because the Claude harness's reported alias set is not symmetric
 * across model families: at the time of writing it offers bare "opus"/"haiku" alongside their
 * "[1m]" variants, but only "sonnet[1m]" — no bare "sonnet" — because the current Sonnet
 * generation ships in a single (1M-context) variant with no separate short-context sibling to
 * back a bare alias. A caller (or the agent-config default) requesting the friendly "sonnet"
 * alias must still resolve, so a bare request matches the harness's own hinted id when that's
 * the only variant on offer. This only widens a request to the harness's actual (equal-or-larger
 * context) variant; it never falls back from a hinted request to a bare id, which would silently
 * shrink the context window.
 *
 * Then a retired id the harness no longer offers resolves to its successor (see
 * `RETIRED_MODEL_SUCCESSORS`), and last a concrete Claude id resolves to its tier alias (see
 * `CLAUDE_TIER_ALIASES`).
 */
export function pickModel(allowed: string[], wanted?: string): string | undefined {
  if (!wanted) return undefined;
  if (allowed.includes(wanted)) return wanted;
  const suffix = (id: string) => id.slice(id.indexOf("/") + 1);
  const match =
    allowed.find((id) => suffix(id) === wanted) ??
    allowed.find((id) => suffix(id) === suffix(wanted)) ??
    allowed.find((id) => id !== wanted && stripContextHint(id) === wanted);
  if (match) return match;
  const successor = retiredModelSuccessor(wanted);
  const upgraded = successor ? pickModel(allowed, successor) : undefined;
  return upgraded ?? pickTierAlias(allowed, wanted);
}

/**
 * Rewrite a Claude run's `anthropic/<id>` model to the bare `<id>` Claude Code names it by, in
 * place, before anything reads `request.model`. The model reaches Claude through two channels:
 * `setModel`, and on a gateway or base-URL run the `ANTHROPIC_MODEL` and
 * `ANTHROPIC_CUSTOM_MODEL_OPTION` env vars. The env vars make any string settable and send it to
 * the endpoint verbatim, so a prefixed id failed there with "model may not exist". A custom
 * deployment keeps its id as given, because that id is the user's own endpoint's name for the
 * model. Idempotent, so every engine entry can call it.
 */
export function normalizeRequestModel(request: AgentRunRequest): void {
  if (harnessKindOf(request.harness) !== "claude") return;
  if (request.modelConnection?.deployment === "custom") return;
  if (request.model?.startsWith("anthropic/")) {
    request.model = request.model.slice("anthropic/".length);
  }
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
        if (retiredModelSuccessor(wanted) && baseModelId(match) !== baseModelId(wanted)) {
          log(`model '${wanted}' is retired by this harness; upgraded to '${match}'`);
        } else if (claudeTierAlias(wanted) && baseModelId(match) !== baseModelId(wanted)) {
          log(`model '${wanted}' is not offered by this harness; running its tier alias '${match}'`);
        }
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
