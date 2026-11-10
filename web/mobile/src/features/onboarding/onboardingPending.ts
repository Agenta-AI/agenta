import {onboardingDraftKey, saveOnboardingDraft} from "./onboardingDraft"

/** Set at sign-up for a new account; while it stands, Home sends that user to onboarding. */
const onboardingPendingKey = (userId: string) => `agenta:onboarding:pending:${userId}`

/** Set when the account joined through an invite: it answers the questions only. */
const onboardingInvitedKey = (userId: string) => `agenta:onboarding:invited:${userId}`

/**
 * Written instead when the profile could not load right after sign-up, so the user id is not
 * known yet. The first user read within the window claims it; after that it is ignored, so a
 * stale one never sends a later account on the same browser to onboarding.
 */
const UNOWNED_PENDING_KEY = "agenta:onboarding:pending:unowned"
export const UNOWNED_PENDING_MAX_AGE_MS = 10 * 60 * 1000

/** `null` user id: the profile is not available yet, so the mark waits to be claimed. */
export const markOnboardingPending = (userId: string | null, at: number = Date.now()) => {
    try {
        window.localStorage.setItem(
            userId ? onboardingPendingKey(userId) : UNOWNED_PENDING_KEY,
            String(at),
        )
    } catch {
        // Storage restrictions only cost the redirect, never the sign-in.
    }
}

/** Moves a fresh unowned mark onto this user; drops a stale one. */
const claimUnownedPending = (userId: string, now: number) => {
    const at = Number(window.localStorage.getItem(UNOWNED_PENDING_KEY))
    if (!at) return
    window.localStorage.removeItem(UNOWNED_PENDING_KEY)
    if (now - at <= UNOWNED_PENDING_MAX_AGE_MS) {
        window.localStorage.setItem(onboardingPendingKey(userId), String(at))
    }
}

export const isOnboardingPending = (userId: string, now: number = Date.now()): boolean => {
    try {
        claimUnownedPending(userId, now)
        return window.localStorage.getItem(onboardingPendingKey(userId)) !== null
    } catch {
        return false
    }
}

export const markOnboardingInvited = (userId: string) => {
    try {
        window.localStorage.setItem(onboardingInvitedKey(userId), "1")
    } catch {
        // Storage restrictions only cost the shorter flow, never the invite.
    }
}

export const isOnboardingInvited = (userId: string): boolean => {
    try {
        return window.localStorage.getItem(onboardingInvitedKey(userId)) !== null
    } catch {
        return false
    }
}

export const clearOnboardingPending = (userId: string) => {
    try {
        window.localStorage.removeItem(onboardingPendingKey(userId))
        window.localStorage.removeItem(onboardingInvitedKey(userId))
    } catch {
        // Nothing to clear when storage is unavailable.
    }
}

/** Create or Skip: the user is done with onboarding, so its mark and answers go. */
export const endOnboarding = (userId: string) => {
    clearOnboardingPending(userId)
    saveOnboardingDraft(onboardingDraftKey(userId), null)
}

/** Home's move on a pending mark: wait for the answer, start onboarding, or dismiss it. */
export type PendingOnboarding = "none" | "wait" | "start" | "dismiss"

export interface PendingOnboardingInput {
    /** The signed-in user's mark; `null` while the user is still loading. */
    pending: boolean | null
    agentCount: number
    agentsPending: boolean
    agentsError: boolean
}

export const resolvePendingOnboarding = ({
    pending,
    agentCount,
    agentsPending,
    agentsError,
}: PendingOnboardingInput): PendingOnboarding => {
    if (pending === false) return "none"
    if (pending === null) return "wait"
    if (agentCount > 0) return "dismiss"
    // A failed list is not an empty project; Home is where it can be retried.
    if (agentsError) return "none"
    return agentsPending ? "wait" : "start"
}
