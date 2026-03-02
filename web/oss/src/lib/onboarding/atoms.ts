import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

import {stringStorage} from "@/oss/state/utils/stringStorage"

import type {CurrentStepState} from "./types"

// Storage keys
const STORAGE_KEYS = {
    ACTIVE_USER_ID: "agenta:onboarding:active-user-id",
    IS_NEW_USER: "is-new-user",
    SEEN_TOURS: "seen-tours",
} as const

export const onboardingStorageUserIdAtom = atomWithStorage<string | null>(
    STORAGE_KEYS.ACTIVE_USER_ID,
    null,
    stringStorage,
)

const createScopedStorageKey = (userId: string, key: string) => `agenta:onboarding:${userId}:${key}`

const isNewUserAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(createScopedStorageKey(userId, STORAGE_KEYS.IS_NEW_USER), false),
)

const seenToursAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<Record<string, number | boolean>>(
        createScopedStorageKey(userId, STORAGE_KEYS.SEEN_TOURS),
        {},
    ),
)

/**
 * Tracks whether the current user is a "new user" who should see onboarding
 *
 * This is set to true when:
 * - User completes signup for the first time
 * - Explicitly triggered via setIsNewUser(true)
 *
 * Set to false when:
 * - User completes all onboarding tours
 * - User explicitly dismisses onboarding
 * - Explicitly triggered via setIsNewUser(false)
 */
export const isNewUserAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return false
        return get(isNewUserAtomFamily(userId))
    },
    (get, set, next: boolean) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(isNewUserAtomFamily(userId), next)
    },
)

/**
 * Tracks which tours have been seen/completed
 *
 * Key: tour ID
 * Value: timestamp when tour was completed (or true for legacy)
 */
export const seenToursAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return {}
        return get(seenToursAtomFamily(userId))
    },
    (get, set, next: Record<string, number | boolean>) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(seenToursAtomFamily(userId), next)
    },
)

/**
 * Mark a tour as seen
 */
export const markTourSeenAtom = atom(null, (get, set, tourId: string) => {
    const seen = get(seenToursAtom)
    if (seen[tourId]) return // Already seen

    set(seenToursAtom, {
        ...seen,
        [tourId]: Date.now(),
    })
})

/**
 * Check if a tour has been seen
 */
export const hasTourBeenSeenAtom = atom((get) => {
    const seen = get(seenToursAtom)
    return (tourId: string) => Boolean(seen[tourId])
})

/**
 * Reset all seen tours (useful for testing or "replay onboarding")
 */
export const resetSeenToursAtom = atom(null, (get, set) => {
    set(seenToursAtom, {})
})

/**
 * Current active tour ID (null if no tour is active)
 */
export const activeTourIdAtom = atom<string | null>(null)

/**
 * Current step state - exposed for the OnboardingCard component
 */
export const currentStepStateAtom = atom<CurrentStepState>({
    step: null,
    currentStep: 0,
    totalSteps: 0,
})
