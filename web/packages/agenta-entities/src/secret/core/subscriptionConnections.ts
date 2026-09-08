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
 * Pi drives a ChatGPT login through its own `openai-codex` provider id, while Codex speaks plain
 * `openai`. The run config stores this value as `agent.llm.provider`, and the server checks the
 * (harness, provider, mode) triple, so a wrong name fails the run.
 */
const RUN_PROVIDER_BY_HARNESS: Record<string, string> = {
    pi_core: "openai-codex",
    codex: "openai",
}

/** The harnesses a subscription connection drives when the record names none. */
export const DEFAULT_SUBSCRIPTION_HARNESSES = ["pi_core"]

export const subscriptionProviderFamily = (provider: string): string =>
    FAMILY_BY_SUBSCRIPTION_PROVIDER[provider] ?? provider

export const subscriptionProviderName = (provider: string): string =>
    NAME_BY_SUBSCRIPTION_PROVIDER[provider] ?? provider

export const subscriptionRunProvider = (harness: string, provider: string): string =>
    RUN_PROVIDER_BY_HARNESS[harness] ?? subscriptionProviderFamily(provider)

/** Whether a row's sign-in can drive a run right now. Anything but `ready` cannot. */
export const subscriptionIsReady = (
    subscription: SubscriptionLoginFacts | null | undefined,
): boolean => subscription?.loginState === "ready"

/**
 * What the row says about itself under its name — one short line per state.
 *
 * `needs_login` carries the API's own reason when it has one. The reason is a short server string
 * (`refresh_rejected`), never a token or a path, so it is safe to print.
 */
export const subscriptionStatusLine = (
    subscription: SubscriptionLoginFacts | null | undefined,
): string => {
    if (!subscription) return ""
    if (subscription.loginState === "ready") return "Connected"
    if (subscription.loginState === "pending_login") return "Not signed in"
    return subscription.loginError
        ? `Sign in needed — ${subscription.loginError}`
        : "Sign in needed"
}

/** The hint a not-ready subscription row shows in the model picker. */
export const SUBSCRIPTION_SIGN_IN_HINT = "Sign in needed"
