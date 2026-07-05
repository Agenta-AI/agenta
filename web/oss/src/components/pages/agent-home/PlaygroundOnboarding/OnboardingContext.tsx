import {createContext, useContext} from "react"

/**
 * Shared onboarding state for the playground-native onboarding mount. The generation-panel arm is
 * injected deep in `MainLayout` (via the playground providers), so it can't receive props directly —
 * it reads the commit action + the ephemeral→real transition through this context.
 */
export interface OnboardingContextValue {
    /** The ephemeral (`local-*`) agent id this mount created. */
    ephemeralId: string
    /** Set once the ephemeral is committed to a real revision in place; null while still ephemeral. */
    realEntityId: string | null
    /** A commit is in flight (disable the composer / show progress). */
    committing: boolean
    /** The seed message of the in-flight (or just-finished) commit — the chat shows it as an
     * optimistic user turn so the switch from onboarding reads as one continuous conversation. */
    committingSeed: string | null
    /** Commit the ephemeral into a real agent IN PLACE (no redirect) and seed the first turn. */
    commit: (seedMessage: string, name?: string) => void
}

export const OnboardingContext = createContext<OnboardingContextValue | null>(null)

export function useOnboardingContext(): OnboardingContextValue {
    const ctx = useContext(OnboardingContext)
    if (!ctx) {
        throw new Error("useOnboardingContext must be used within an OnboardingContext provider")
    }
    return ctx
}

/**
 * Optional variant — returns `null` when there's no provider. Used by the shared `AgentChatPanel`, which
 * renders in many places: only inside the onboarding playground is the context present, so a null result
 * means "not onboarding, behave normally" and every other usage is untouched.
 */
export function useOptionalOnboardingContext(): OnboardingContextValue | null {
    return useContext(OnboardingContext)
}
