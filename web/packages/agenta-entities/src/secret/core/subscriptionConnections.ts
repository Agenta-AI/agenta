/**
 * Hosted subscription connections — the `subscription_provider` vault kind.
 *
 * A hosted subscription is a stored vault record like any other connection, but its credential is a
 * provider SIGN-IN rather than a key: the user signs in once with a device code and the login lives
 * encrypted on the row. The login never comes back to the browser, so a row reports only how usable
 * it is (`login_state`) and what it can run.
 *
 * This module holds the pure rules: the wire kind, the family and plan names, which harness names
 * which provider on a run, and the picker candidates a ready connection contributes. No React, no
 * atoms, no HTTP.
 *
 * Design: docs/design/hosted-subscription-connections/implementation-contract.md §1 and §4.
 */

import type {SubscriptionLoginFacts} from "@agenta/shared/types"

/**
 * The vault kind. Not read off Fern's `SecretKind`: the generated client is regenerated from the
 * backend spec on its own cadence, and the picker must not go dark for a release because of it.
 */
export const SUBSCRIPTION_PROVIDER_KIND = "subscription_provider"

/** The three states the API publishes for a stored sign-in. */
export const SUBSCRIPTION_LOGIN_STATES = ["pending_login", "ready", "needs_login"] as const
export type SubscriptionLoginState = (typeof SUBSCRIPTION_LOGIN_STATES)[number]

/** The provider FAMILY a subscription product belongs to — what logos and model catalogs key on. */
const FAMILY_BY_SUBSCRIPTION_PROVIDER: Record<string, string> = {
    chatgpt: "openai",
}

/** The user-visible name of a subscription product. */
const NAME_BY_SUBSCRIPTION_PROVIDER: Record<string, string> = {
    chatgpt: "ChatGPT",
}

/**
 * What a harness calls the provider when it runs on a subscription login.
 *
 * Pi drives a ChatGPT login through its own `openai-codex` provider id. The run config stores this
 * value as `agent.llm.provider`, and the server checks the (harness, provider, mode) triple, so a
 * wrong name fails the run.
 *
 * Pi is the only entry. Codex refuses a login file without an `id_token`, which the ChatGPT device
 * login never issues, so offering a Codex row would offer a run that cannot authenticate. The SDK
 * refuses the same pair at resolution. Add a harness here once its credential format is supported.
 */
const RUN_PROVIDER_BY_HARNESS: Record<string, string> = {
    pi_core: "openai-codex",
}

/** The harnesses a subscription connection drives when the record names none. */
export const DEFAULT_SUBSCRIPTION_HARNESSES = ["pi_core"]

export const subscriptionProviderFamily = (provider: string): string =>
    FAMILY_BY_SUBSCRIPTION_PROVIDER[provider] ?? provider

export const subscriptionProviderName = (provider: string): string =>
    NAME_BY_SUBSCRIPTION_PROVIDER[provider] ?? provider

/**
 * The provider name a run carries, or `null` when this harness cannot use a subscription login.
 *
 * `null` is what keeps an unusable pair out of the picker: the caller drops the candidate rather
 * than offering a row whose run the server would refuse.
 */
export const subscriptionRunProvider = (harness: string, _provider: string): string | null =>
    RUN_PROVIDER_BY_HARNESS[harness] ?? null

/** Whether a row's sign-in can drive a run right now. Anything but `ready` cannot. */
export const subscriptionIsReady = (
    subscription: SubscriptionLoginFacts | null | undefined,
): boolean => subscription?.loginState === "ready"

/** The hint a not-ready subscription row shows in the model picker, and the card's status word. */
export const SUBSCRIPTION_SIGN_IN_HINT = "Sign in needed"

/**
 * The reasons that mean the stored sign-in is dead rather than merely stale.
 *
 * `login_unreadable` is a file the runner could not parse. `refresh_rejected` is the provider
 * refusing the refresh token. `refresh_status_*` carries an HTTP status from the same exchange.
 */
const DEAD_LOGIN_REASONS = new Set(["login_unreadable", "refresh_rejected"])
const DEAD_LOGIN_REASON_PREFIX = "refresh_status_"

/**
 * The reason in a sentence a user can act on.
 *
 * The server's reason is a machine slug (`refresh_rejected`). It is safe to print, no token and no
 * path, but it is a log line, not an explanation: it tells the user nothing they can do. So the
 * known slugs map to one sentence each, and an unrecognized one falls back to the honest general
 * case rather than leaking a word the product never taught.
 */
const subscriptionFailureSentence = (provider: string, reason: string): string => {
    const product = subscriptionProviderName(provider)
    const isDead = DEAD_LOGIN_REASONS.has(reason) || reason.startsWith(DEAD_LOGIN_REASON_PREFIX)
    return isDead
        ? `The ${product} sign-in is no longer valid.`
        : `The ${product} sign-in needs to be renewed.`
}

/**
 * What the row says about itself under its name — one short line per state.
 *
 * `needs_login` keeps "Sign in needed" as the status word and adds the reason as a sentence. A row
 * that reports no reason says only the status word: there is nothing to explain.
 */
export const subscriptionStatusLine = (
    subscription: SubscriptionLoginFacts | null | undefined,
): string => {
    if (!subscription) return ""
    if (subscription.loginState === "ready") return "Connected"
    if (subscription.loginState === "pending_login") return "Not signed in"
    return subscription.loginError
        ? `${SUBSCRIPTION_SIGN_IN_HINT}. ${subscriptionFailureSentence(
              subscription.provider,
              subscription.loginError,
          )}`
        : SUBSCRIPTION_SIGN_IN_HINT
}

/** The shape the availability rules read. Structural, so this module stays free of the row type. */
export interface SubscriptionRowFacts {
    harnesses?: string[] | null
    subscription?: SubscriptionLoginFacts | null
}

/** The harnesses a row drives: the ones it names, or the default when it names none. */
export const subscriptionHarnesses = (row: SubscriptionRowFacts): readonly string[] =>
    row.harnesses?.length ? row.harnesses : DEFAULT_SUBSCRIPTION_HARNESSES

/**
 * What a hosted subscription row is worth to a surface narrowed to `harnessIds`.
 *
 * One rule for every surface that shows the row. `not_applicable` means the row has nothing to say
 * here — a ChatGPT subscription drives Pi, so an agent that runs only Claude gains nothing by
 * signing in, and telling it to sign in would be a false instruction. `sign_in_needed` is the only
 * state that earns a disabled row: it is the one the user can act on.
 *
 * An undefined `harnessIds` means no narrowing at all, so every row applies.
 */
export type SubscriptionAvailability = "ready" | "sign_in_needed" | "not_applicable"

export const subscriptionAvailability = (
    row: SubscriptionRowFacts,
    harnessIds?: readonly string[],
): SubscriptionAvailability => {
    const drives =
        !harnessIds || subscriptionHarnesses(row).some((harness) => harnessIds.includes(harness))
    if (!drives) return "not_applicable"
    return subscriptionIsReady(row.subscription) ? "ready" : "sign_in_needed"
}
