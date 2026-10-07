import {onboardingDraftKey, saveOnboardingDraft} from "./onboardingDraft"

/** Set at sign-up for a new account; while it stands, Home sends that user to onboarding. */
const onboardingPendingKey = (userId: string) => `agenta:onboarding:pending:${userId}`

export const markOnboardingPending = (userId: string, at: number = Date.now()) => {
    try {
        window.localStorage.setItem(onboardingPendingKey(userId), String(at))
    } catch {
        // Storage restrictions only cost the redirect, never the sign-in.
    }
}

export const isOnboardingPending = (userId: string): boolean => {
    try {
        return window.localStorage.getItem(onboardingPendingKey(userId)) !== null
    } catch {
        return false
    }
}

export const clearOnboardingPending = (userId: string) => {
    try {
        window.localStorage.removeItem(onboardingPendingKey(userId))
    } catch {
        // Nothing to clear when storage is unavailable.
    }
}

/** Create: the user is done with onboarding, so its mark and answers go. */
export const endOnboarding = (userId: string) => {
    clearOnboardingPending(userId)
    saveOnboardingDraft(onboardingDraftKey(userId), null)
}

/** Home's move on a pending mark: wait for the answer, start onboarding, or dismiss it. */
export type PendingOnboarding = "none" | "wait" | "start" | "dismiss"

export interface PendingOnboardingInput {
    enabled: boolean
    /** The signed-in user's mark; `null` while the user is still loading. */
    pending: boolean | null
    agentCount: number
    agentsPending: boolean
    agentsError: boolean
}

export const resolvePendingOnboarding = ({
    enabled,
    pending,
    agentCount,
    agentsPending,
    agentsError,
}: PendingOnboardingInput): PendingOnboarding => {
    if (!enabled || pending === false) return "none"
    if (pending === null) return "wait"
    if (agentCount > 0) return "dismiss"
    // A failed list is not an empty project; Home is where it can be retried.
    if (agentsError) return "none"
    return agentsPending ? "wait" : "start"
}
