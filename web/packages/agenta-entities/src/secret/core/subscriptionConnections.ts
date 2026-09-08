// Pure rules for the `subscription_provider` vault kind, whose credential is a sign-in the browser
// never sees. Design: docs/design/hosted-subscription-connections/implementation-contract.md §1.

import type {SubscriptionLoginFacts} from "@agenta/shared/types"

// Not read off Fern's `SecretKind`: a regenerated client must not take the picker dark.
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

// The provider id a run carries. Pi only: Codex needs an `id_token` the device login never issues.
const RUN_PROVIDER_BY_HARNESS: Record<string, string> = {
    pi_core: "openai-codex",
}

/** The harnesses a subscription connection drives when the record names none. */
export const DEFAULT_SUBSCRIPTION_HARNESSES = ["pi_core"]

export const subscriptionProviderFamily = (provider: string): string =>
    FAMILY_BY_SUBSCRIPTION_PROVIDER[provider] ?? provider

export const subscriptionProviderName = (provider: string): string =>
    NAME_BY_SUBSCRIPTION_PROVIDER[provider] ?? provider

/** The run's provider name, or `null` to keep a pair the server would refuse out of the picker. */
export const subscriptionRunProvider = (harness: string, _provider: string): string | null =>
    RUN_PROVIDER_BY_HARNESS[harness] ?? null

/** Whether a row's sign-in can drive a run right now. Anything but `ready` cannot. */
export const subscriptionIsReady = (
    subscription: SubscriptionLoginFacts | null | undefined,
): boolean => subscription?.loginState === "ready"

/** The hint a not-ready subscription row shows in the model picker, and the card's status word. */
export const SUBSCRIPTION_SIGN_IN_HINT = "Sign in needed"

// The reasons that mean the stored sign-in is dead rather than merely stale.
const DEAD_LOGIN_REASONS = new Set(["login_unreadable", "refresh_rejected"])
const DEAD_LOGIN_REASON_PREFIX = "refresh_status_"

// The server's reason is a log-line slug, so it never reaches a user: map it to a sentence.
const subscriptionFailureSentence = (provider: string, reason: string): string => {
    const product = subscriptionProviderName(provider)
    const isDead = DEAD_LOGIN_REASONS.has(reason) || reason.startsWith(DEAD_LOGIN_REASON_PREFIX)
    return isDead
        ? `The ${product} sign-in is no longer valid.`
        : `The ${product} sign-in needs to be renewed.`
}

// Same for an attempt's error, which is a different slug vocabulary from the row's.
export const subscriptionAttemptErrorSentence = (
    reason: string | null | undefined,
    provider = "chatgpt",
): string => {
    const product = subscriptionProviderName(provider)
    if (!reason) return "The sign-in did not complete. Try again."
    if (reason.startsWith("attempt not found"))
        return "Agenta lost track of that sign-in. Start it again."
    if (reason === "invalid_login")
        return `${product} returned a sign-in Agenta cannot use. Try again.`
    if (reason === "access_denied") return `The ${product} sign-in was declined.`
    if (reason === "expired_token" || reason === "expired")
        return "The sign-in code expired. Start again."
    return "The sign-in did not complete. Try again."
}

/** One short line per state, with the reason appended when the row carries one. */
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

// `not_applicable` means signing in would not help this surface, so it must not be offered.
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
