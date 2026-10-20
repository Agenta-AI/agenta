// Pure rules for the `subscription_provider` vault kind, whose credential is a sign-in the browser
// never sees. Design: docs/design/hosted-subscription-connections/implementation-contract.md §1.

import type {SubscriptionLoginFacts} from "@agenta/shared/types"

// Not read off Fern's `SecretKind`: a regenerated client must not take the picker dark.
export const SUBSCRIPTION_PROVIDER_KIND = "subscription_provider"

/** The three states the API publishes for a stored sign-in. */
export const SUBSCRIPTION_LOGIN_STATES = ["pending_login", "ready", "needs_login"] as const
export type SubscriptionLoginState = (typeof SUBSCRIPTION_LOGIN_STATES)[number]

/** How a person connects a subscription: a device-code sign-in, or a pasted token. */
export type SubscriptionConnectMethod = "device" | "token"

interface SubscriptionProviderEntry {
    /** The user-visible name of the product. */
    name: string
    /** The provider FAMILY the product belongs to — what logos and model catalogs key on. */
    family: string
    connectMethod: SubscriptionConnectMethod
    /** The provider id a run carries, per harness that can consume this subscription. */
    runProviders: Record<string, string>
}

const SUBSCRIPTION_PROVIDERS: Record<string, SubscriptionProviderEntry> = {
    // Pi only: Codex needs an `id_token` the device login never issues.
    chatgpt: {
        name: "ChatGPT",
        family: "openai",
        connectMethod: "device",
        runProviders: {pi_core: "openai-codex"},
    },
    // A `claude setup-token` value, which only the Claude Code harness reads.
    claude: {
        name: "Claude",
        family: "anthropic",
        connectMethod: "token",
        runProviders: {claude: "anthropic"},
    },
}

/** The harnesses a subscription connection drives when the record names none. */
export const DEFAULT_SUBSCRIPTION_HARNESSES = ["pi_core"]

export const subscriptionProviderFamily = (provider: string): string =>
    SUBSCRIPTION_PROVIDERS[provider]?.family ?? provider

export const subscriptionProviderName = (provider: string): string =>
    SUBSCRIPTION_PROVIDERS[provider]?.name ?? provider

/** How the provider is connected. An unknown provider gets the device sign-in it always had. */
export const subscriptionConnectMethod = (provider: string): SubscriptionConnectMethod =>
    SUBSCRIPTION_PROVIDERS[provider]?.connectMethod ?? "device"

/** The run's provider name, or `null` to keep a pair the server would refuse out of the picker. */
export const subscriptionRunProvider = (harness: string, provider: string): string | null =>
    SUBSCRIPTION_PROVIDERS[provider]?.runProviders[harness] ?? null

/** The project's connection for one subscription provider. A project holds at most one. */
export const subscriptionConnectionFor = <T extends {subscription?: {provider: string} | null}>(
    connections: readonly T[],
    provider: string,
): T | null => connections.find((item) => item.subscription?.provider === provider) ?? null

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

/**
 * Why a pasted token was not stored, from the API's `{message, next_step}` refusal, as one line.
 * `null` when the error carries no such refusal, so the caller picks its own sentence.
 */
export const subscriptionTokenErrorText = (error: unknown): string | null => {
    const detail = (error as {body?: {detail?: unknown}} | null)?.body?.detail
    if (!detail || typeof detail !== "object") return null
    const {message, next_step: nextStep} = detail as {message?: unknown; next_step?: unknown}
    if (typeof message !== "string" || !message) return null
    return typeof nextStep === "string" && nextStep ? `${message} ${nextStep}` : message
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

/** The harnesses a row drives: the ones it names, else its provider's, else the default. */
export const subscriptionHarnesses = (row: SubscriptionRowFacts): readonly string[] => {
    if (row.harnesses?.length) return row.harnesses
    const runProviders = SUBSCRIPTION_PROVIDERS[row.subscription?.provider ?? ""]?.runProviders
    return runProviders ? Object.keys(runProviders) : DEFAULT_SUBSCRIPTION_HARNESSES
}

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
