/**
 * A subscription connection's status line and sign-in errors in the active language.
 * `@agenta/entities` reads the state and the server's reason; this module gives them words.
 */
import {
    subscriptionAttemptFailure,
    subscriptionProviderName,
    subscriptionStatus,
} from "@agenta/entities/secret"
import {createT} from "@agenta/i18n"
import subscriptionSignInCatalog from "@agenta/i18n/catalogs/entityUi.subscriptionSignIn"
import type {SubscriptionLoginFacts} from "@agenta/shared/types"

const tNow = createT(subscriptionSignInCatalog)

/** The hint a not-ready subscription row shows in the model picker, and the card's status word. */
export const subscriptionSignInHint = (): string => tNow("entityUi.subscriptionSignIn.signInNeeded")

/** One short line per state, with the reason in a sentence when the row carries one. */
export const subscriptionStatusLine = (
    subscription: SubscriptionLoginFacts | null | undefined,
): string => {
    const product = subscription ? subscriptionProviderName(subscription.provider) : ""
    switch (subscriptionStatus(subscription)) {
        case null:
            return ""
        case "connected":
            return tNow("entityUi.subscriptionSignIn.connectedStatus")
        case "notSignedIn":
            return tNow("entityUi.subscriptionSignIn.notSignedIn")
        case "signInNeeded":
            return subscriptionSignInHint()
        case "signInNoLongerValid":
            return tNow("entityUi.subscriptionSignIn.signInNoLongerValid", {product})
        case "signInNeedsRenewal":
            return tNow("entityUi.subscriptionSignIn.signInNeedsRenewal", {product})
    }
}

/** Why a sign-in attempt failed, in a sentence: never the slug the server used. */
export const subscriptionAttemptErrorSentence = (
    reason: string | null | undefined,
    provider = "chatgpt",
): string => {
    const product = subscriptionProviderName(provider)
    switch (subscriptionAttemptFailure(reason)) {
        case "lost":
            return tNow("entityUi.subscriptionSignIn.attemptLost")
        case "invalidLogin":
            return tNow("entityUi.subscriptionSignIn.attemptInvalidLogin", {product})
        case "declined":
            return tNow("entityUi.subscriptionSignIn.attemptDeclined", {product})
        case "expired":
            return tNow("entityUi.subscriptionSignIn.codeExpired")
        case "incomplete":
            return tNow("entityUi.subscriptionSignIn.attemptIncomplete")
    }
}
