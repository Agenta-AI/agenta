/**
 * litellmModelId — the one place a provider's own model id becomes litellm's, and back.
 *
 * A connection stores what the provider itself calls a model (`claude-sonnet-5`, exactly as its
 * /models endpoint returned it), because that id resolves in every harness. The prompt runtime is
 * litellm, which addresses the same model as `anthropic/claude-sonnet-5`. The picker is where the
 * two spellings meet: an option's VALUE — the id a prompt config persists — is always litellm's,
 * while its label stays the provider's, so nothing on screen changes shape.
 *
 * Translating at pick time (rather than storing litellm ids on the connection, or rewriting at run
 * time) keeps one rule: a stored config is litellm-ready as written, and a model the catalog never
 * listed — freshly discovered, or typed in by hand — still gets a correct prefix.
 *
 * This table is kept identical to the SDK's `litellm_provider_prefixes`, key and value; a family
 * the two spell differently is a persisted id that resolves to nothing. `mistralai` is the one
 * entry with no counterpart there — the SDK aliases it to `mistral` before the lookup, same
 * result. Adding a kind here means adding it there in the same change.
 *
 * Design: docs/design/provider-connections-models/plan.md.
 */

import {secretKindForProviderKind} from "./providerCatalog"
import {SecretKind, type StandardProviderKind} from "./types"

/**
 * The litellm prefix each standard provider family's models carry, or null when they carry none.
 *
 * Null covers two different situations: `openai` because bare ids ARE litellm's OpenAI spelling,
 * and the modelless kinds at the bottom because litellm has no provider to prefix them for.
 * `perplexityai` maps to `perplexity` — the vault kind and the litellm family disagree.
 * `Record<StandardProviderKind, …>` so a family added to the wire enum fails the build here rather
 * than silently defaulting to "no prefix".
 */
export const LITELLM_MODEL_PREFIXES: Readonly<Record<StandardProviderKind, string | null>> = {
    openai: null,
    anthropic: "anthropic",
    cohere: "cohere",
    deepinfra: "deepinfra",
    groq: "groq",
    minimax: "minimax",
    mistral: "mistral",
    // Legacy alias of the `mistral` kind; litellm knows only the one family.
    mistralai: "mistral",
    perplexityai: "perplexity",
    together_ai: "together_ai",
    openrouter: "openrouter",
    gemini: "gemini",
    // The two stored kinds with no catalog models and no litellm provider: litellm 1.92.0 knows
    // neither service (both wound down), so `aleph_alpha/luminous-base` fails with the same "LLM
    // Provider NOT provided" as the bare id. Identity rather than the "anyscale"/"aleph_alpha"
    // spellings they would take if the providers still existed — a prefix that cannot route is a
    // false claim. The keys stay so both halves cover the same set of kinds.
    anyscale: null,
    alephalpha: null,
}

/**
 * The prefix a family's ids take, or null when this family is not translated at all.
 *
 * Custom-provider kinds (azure, bedrock, sagemaker, vertex_ai, custom) return null by contract:
 * their stored keys are already `slug/kind/model`, which the resolver rewrites itself, and a kind
 * like `azure` names a deployment rather than a litellm family. An unknown family returns null
 * too — guessing a prefix would break an id that works today.
 */
const litellmPrefixFor = (family: string | null | undefined): string | null => {
    if (!family) return null
    if (secretKindForProviderKind(family) === SecretKind.CustomProvider) return null
    return (LITELLM_MODEL_PREFIXES as Record<string, string | null | undefined>)[family] ?? null
}

/**
 * The model id litellm addresses, given the family whose connection offers it.
 *
 * Idempotent: an id already carrying its family's prefix is returned unchanged. Only the family's
 * OWN prefix is ever added, never a vendor segment — `anthropic/claude-opus-4.8` offered by an
 * OpenRouter connection becomes `openrouter/anthropic/claude-opus-4.8`, and passing that back
 * through leaves it alone.
 */
export const toLitellmModelId = (model: string, family: string | null | undefined): string => {
    const prefix = litellmPrefixFor(family)
    if (!model || !prefix) return model
    return model.startsWith(`${prefix}/`) ? model : `${prefix}/${model}`
}

/** The provider's own spelling of a litellm id: its family prefix stripped, if it carries one. */
export const fromLitellmModelId = (model: string, family: string | null | undefined): string => {
    const prefix = litellmPrefixFor(family)
    if (!model || !prefix) return model
    return model.startsWith(`${prefix}/`) ? model.slice(prefix.length + 1) : model
}
