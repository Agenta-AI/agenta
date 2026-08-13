/**
 * Subscription × harness pairs — the unit the drawer lists and models are configured for.
 *
 * A subscription is one consumer plan (a Claude plan, a ChatGPT plan) that the deployment mounts
 * for the runner. The same plan can drive more than one harness — a ChatGPT login is read by both
 * Codex and Pi — and each of those combinations offers its own models under its own spelling. So
 * the row is the PAIR, never the plan: the runner reports one login state per harness, and every
 * harness whose login is usable contributes a row per plan it can drive — one for a harness tied
 * to a provider, and one per family for Pi, whose single mount can hold several logins at once.
 *
 * There is at most one subscription per provider, so pairs multiply by harness and never by count:
 * "Claude subscription 2" is not a state this can produce.
 *
 * Design: providers-drawer-final/README.md §5 ("Subscriptions").
 */

/** One harness entry of the runner's subscription-status answer, as the drawer reads it. */
export interface SubscriptionHarnessStatus {
    state: string
    provider?: string | null
    /**
     * For a harness that reads whichever logins are mounted (Pi), the provider families its login
     * file actually holds — one pair per family. A harness tied to one provider names it in
     * `provider` instead, and an older runner sends neither.
     */
    providers?: string[] | null
}

/** One subscription × harness pair: a provider plan the runner can drive through one harness. */
export interface SubscriptionPair {
    /** Stable row identity — the pair, not the plan. */
    key: string
    /** Provider family the logo is looked up by (`anthropic`, `openai`). */
    provider: string
    /** The plan's consumer name: `Claude`, `ChatGPT`. */
    name: string
    /** The harness id this pair runs in (`claude`, `codex`, `pi_core`). */
    harness: string
}

/**
 * The consumer name of a provider's plan. Deliberately the product a user pays for, not the
 * company: nobody has an "Anthropic subscription", they have a Claude plan.
 */
const PLAN_NAME_BY_PROVIDER: Record<string, string> = {
    anthropic: "Claude",
    openai: "ChatGPT",
}

/**
 * The provider a harness's own login belongs to, for a runner that reports a state without naming
 * one. Only the harnesses that ARE a provider's client can be resolved this way — a general
 * harness (Pi) reads whichever logins are mounted, so its entry has to name them itself.
 */
const PROVIDER_BY_HARNESS: Record<string, string> = {
    claude: "anthropic",
    codex: "openai",
}

/** The plan name for a provider family, falling back to the family itself. */
export const subscriptionPlanName = (provider: string): string =>
    PLAN_NAME_BY_PROVIDER[provider] ?? provider

/**
 * Every usable subscription × harness pair the runner reported, in harness-id order.
 *
 * Only `ready` counts. The other states are setup states — a missing folder, an unreadable login —
 * and the drawer says nothing about them: a row with a green dot means it works, and everything
 * else is what the setup guide is for.
 */
export const subscriptionPairsFrom = (
    harnesses: Record<string, SubscriptionHarnessStatus> | null | undefined,
): SubscriptionPair[] => {
    if (!harnesses) return []

    const pairs: SubscriptionPair[] = []
    const seen = new Set<string>()

    for (const harness of Object.keys(harnesses).sort()) {
        const entry = harnesses[harness]
        if (entry?.state !== "ready") continue

        // A harness that named the families its login holds contributes one pair per family — a Pi
        // mount holding a ChatGPT and a Claude login runs both plans. Everything else has at most
        // the one provider, its own or its harness's.
        const providers = entry.providers?.length
            ? entry.providers
            : [entry.provider || PROVIDER_BY_HARNESS[harness]]

        for (const provider of providers) {
            // A ready login we cannot attribute to a provider has no name and no logo to draw; a
            // row that says nothing is worse than no row.
            if (!provider) continue

            const key = `${provider}:${harness}`
            if (seen.has(key)) continue
            seen.add(key)

            pairs.push({key, provider, name: subscriptionPlanName(provider), harness})
        }
    }

    return pairs
}

/**
 * The models one harness offers for a provider family — the plan's fixed list.
 *
 * Per harness, not the union `providerModelCatalog` builds: a pair IS one harness, and the ids it
 * runs are the ones that harness published.
 */
export const subscriptionPairModels = (
    capabilities:
        | Record<
              string,
              {models?: Record<string, string[]>; default_models?: Record<string, string[]>}
          >
        | null
        | undefined,
    pair: {harness: string; provider: string},
): {models: string[]; defaults: string[]} => {
    const harness = capabilities?.[pair.harness]
    const models = harness?.models?.[pair.provider] ?? []
    const defaults = new Set(harness?.default_models?.[pair.provider] ?? [])
    return {models: [...models], defaults: models.filter((id) => defaults.has(id))}
}
