import {
    type ActivityFailure,
    BUY_CREDITS_CODES,
    NOT_SENT_CODES,
    OWN_KEY_CODES,
    planLimitTitle,
    refusalTitle,
    RETRYABLE_CODES,
    STARTER_CREDIT_CODES,
    SUBSCRIPTION_LOGIN_CODES,
} from "@agenta/chat/components"
import {Coins, CreditCard, Key, SignIn} from "@phosphor-icons/react"

import {proseClassName} from "./AssistantMarkdown"
import {formatRunError} from "./runError"
import type {RunErrorRecoveryAction} from "./RunErrorRecovery"

/** Errors the model provider returned itself, worded by the runner or the gateway. */
const PROVIDER_ERROR_CODES = new Set(["provider_error", "upstream_error", "upstream_rejected"])

export interface RunErrorInput {
    text: string
    /** The runner's failure class, when the turn carried one. */
    code?: string
    /** The request never reached Agenta: retryable, and it has no code to match on. */
    transport?: boolean
    onRetry?: () => void
    /** The ways out this page can open in place; one it cannot open is not offered. */
    can: {providers: boolean; buyCredits: boolean; plans: boolean}
    /** Sign-in has no in-place surface yet, so it routes to the providers page. */
    onSignIn?: () => void
}

export interface RunFailureView {
    /** The server's text, shaped as the agent's own message would read. */
    paragraphs: string[]
    /** The provider's own words, shown under our sentence. */
    quote: string | null
    /** The fold's header label and the server's raw text, its last step. */
    failure: ActivityFailure
    /** Send the turn again, when the failure is one another attempt may get past. */
    onRetry?: () => void
    /** The ways out, at most two, drawn as cards between the message and the footer. */
    recoveries: RunErrorRecoveryAction[]
}

/** A failed run split across the turn: fold label and raw text, answer prose, one way out. */
export const describeRunFailure = ({
    text,
    code,
    transport,
    onRetry,
    can,
    onSignIn,
}: RunErrorInput): RunFailureView => {
    const title = refusalTitle(code)
    // Provider errors, plan limits and worded refusals are finished sentences: show them whole.
    const {paragraphs, quote, kind, provider, raw} = formatRunError(text, {
        whole: (!!code && PROVIDER_ERROR_CODES.has(code)) || !!title,
    })
    // An admission refusal never left the composer; replaying it would be refused again.
    const notSent = !!code && NOT_SENT_CODES.has(code)
    // Retry what a new attempt or the reader's own fix may clear; never a bare model refusal.
    const retry =
        !notSent &&
        !!onRetry &&
        (!!kind ||
            !!transport ||
            !!title ||
            (!!code &&
                (RETRYABLE_CODES.has(code) ||
                    OWN_KEY_CODES.has(code) ||
                    SUBSCRIPTION_LOGIN_CODES.has(code))))
    const has = (codes: Set<string>) => !!code && codes.has(code)

    const addKey: RunErrorRecoveryAction = {
        icon: Key,
        title: "Use your own provider key",
        description: "OpenAI, Anthropic or another provider.",
        cta: "Add key",
        target: {kind: "providers"},
    }
    const buyCredits: RunErrorRecoveryAction = {
        icon: Coins,
        title: "Top up your credits",
        description: "A credit pack for your organization.",
        cta: "Buy credits",
        target: {kind: "buy-credits"},
    }
    const seePlans = (description: string): RunErrorRecoveryAction => ({
        icon: CreditCard,
        title: "Compare plans",
        description,
        cta: "See plans",
        target: {kind: "plans"},
    })

    // One way out, never a menu: the first that applies wins.
    const wayOut = (): RunErrorRecoveryAction | null => {
        if (onSignIn && has(SUBSCRIPTION_LOGIN_CODES)) {
            return {
                icon: SignIn,
                title: "Sign in to your subscription",
                description: "Your saved sign-in expired.",
                cta: "Sign in",
                target: {kind: "route", onClick: onSignIn},
            }
        }
        if (can.providers && has(OWN_KEY_CODES)) return addKey
        if (can.buyCredits && has(BUY_CREDITS_CODES)) return buyCredits
        if (can.plans && planLimitTitle(code)) return seePlans("A higher plan raises this limit.")
        if (kind === "credits" && provider) {
            return {
                icon: Coins,
                title: `Add credits on ${provider.name}`,
                description: "Top up there, then try again.",
                cta: `Open ${provider.name}`,
                target: {kind: "external", href: provider.billingUrl},
            }
        }
        if (can.providers && (kind === "credits" || kind === "key")) {
            return {
                icon: Key,
                title: "Check your provider key",
                description:
                    kind === "credits"
                        ? "Top up at the provider, or swap the key."
                        : "Replace the key the provider rejected.",
                cta: kind === "credits" ? "Open providers" : "Update key",
                target: {kind: "providers", providerKind: provider?.kind},
            }
        }
        return null
    }

    let shown = paragraphs
    let recoveries: RunErrorRecoveryAction[]
    if (has(STARTER_CREDIT_CODES)) {
        // Free credits used up: more credits or the reader's own key, in the platform's words.
        const credits = can.buyCredits
            ? buyCredits
            : can.plans
              ? seePlans("Paid plans include monthly credits.")
              : null
        const key = can.providers ? addKey : null
        const more = can.buyCredits ? "Buy more credits" : "Upgrade your plan"
        const remedy =
            credits && key
                ? `${more}, or add your own provider key to keep going.`
                : credits
                  ? `${more} to keep going.`
                  : paragraphs.slice(1).join(" ")
        const [lead = ""] = paragraphs[0].split(/(?<=[.!?])\s+/)
        shown = [lead, remedy].filter(Boolean)
        recoveries = [credits, key].filter((item) => item !== null)
    } else {
        const recovery = wayOut()
        recoveries = recovery ? [recovery] : []
    }

    return {
        paragraphs: shown,
        quote,
        failure: {
            label: title ?? (notSent ? "Message not sent" : "Run stopped"),
            detail: raw,
        },
        onRetry: retry ? onRetry : undefined,
        recoveries,
    }
}

/** The failure's message, in the answer's own type: plain paragraphs, never parsed as markdown. */
export const RunErrorMessage = ({
    paragraphs,
    quote,
}: {
    paragraphs: string[]
    quote: string | null
}) => {
    const [lead, ...rest] = paragraphs
    return (
        <div className={proseClassName}>
            <p>{lead}</p>
            {quote ? (
                // The provider's own words, set apart from ours.
                <p className="border-l-2 border-border pl-3 !text-muted-foreground">{quote}</p>
            ) : null}
            {rest.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
            ))}
        </div>
    )
}
