import {atom} from "jotai"

import {selectedVariantsAtom, viewTypeAtom} from "./core"

type UserSaveState = {
    userSavedVariant: string
    userSaveTimestamp: string
    isRecentUserSave: boolean
} | null

/**
 * URL Synchronization and Variant Selection Atoms
 *
 * These atoms handle URL-based variant selection, user save detection,
 * and automatic state synchronization using Jotai's derived atom pattern.
 * This replaces the imperative useEffect-based approach with a more
 * performant and idiomatic Jotai solution.
 */

// Atom to track URL revisions from router query (not persisted to avoid conflicts)
// Add a sanitized write layer to prevent null/undefined/empty values leaking into URL state
const _urlRevisionsBaseAtom = atom<string[]>([])
export const urlRevisionsAtom = atom(
    (get) => get(_urlRevisionsBaseAtom),
    (get, set, revisions: unknown) => {
        const next = Array.isArray(revisions) ? revisions : []
        // Sanitize: keep only non-empty strings, drop null/undefined and dedupe
        const sanitized = Array.from(
            new Set(
                next.filter(
                    (id): id is string =>
                        typeof id === "string" &&
                        id.trim().length > 0 &&
                        id !== "null" &&
                        id !== "undefined",
                ),
            ),
        )
        set(_urlRevisionsBaseAtom, sanitized)
    },
)

// Atom to bypass URL synchronization (e.g., on evaluation pages)
export const urlSyncBypassAtom = atom<boolean>(false)

// Atom to track user save flags - writable atom for better reactivity
export const userSaveStateAtom = atom<UserSaveState>(
    // Initial state from session storage
    (() => {
        if (typeof window === "undefined") return null

        const userSavedVariant = sessionStorage.getItem("agenta_user_saved_variant")
        const userSaveTimestamp = sessionStorage.getItem("agenta_user_save_timestamp")
        const isRecentUserSave =
            userSaveTimestamp && Date.now() - parseInt(userSaveTimestamp) < 5000 // 5 seconds

        return {
            userSavedVariant,
            userSaveTimestamp,
            isRecentUserSave: Boolean(isRecentUserSave && userSavedVariant),
        }
    })(),
    // Write function to update the atom and session storage
    (get, set, update: {userSavedVariant: string; userSaveTimestamp: string} | null) => {
        if (typeof window === "undefined") return

        if (update) {
            // Set session storage
            sessionStorage.setItem("agenta_user_saved_variant", update.userSavedVariant)
            sessionStorage.setItem("agenta_user_save_timestamp", update.userSaveTimestamp)

            // Update atom state
            const isRecentUserSave = Date.now() - parseInt(update.userSaveTimestamp) < 5000 // 5 seconds
            set(userSaveStateAtom, {
                userSavedVariant: update.userSavedVariant,
                userSaveTimestamp: update.userSaveTimestamp,
                isRecentUserSave: Boolean(isRecentUserSave && update.userSavedVariant),
            })
        } else {
            // Clear session storage and atom state
            sessionStorage.removeItem("agenta_user_saved_variant")
            sessionStorage.removeItem("agenta_user_save_timestamp")
            set(userSaveStateAtom, null)
        }
    },
)

// Removed deprecated computed atoms in favor of focused selectors and displayedVariantsAtom

// Write-only atom to clear user save flags after processing
export const clearUserSaveFlagsAtom = atom(null, (get, set) => {
    // Use the writable userSaveStateAtom to clear flags
    set(userSaveStateAtom, null)
})

// Write-only atom to update URL revisions
export const updateUrlRevisionsAtom = atom(null, (get, set, revisions: string[]) => {
    set(urlRevisionsAtom, revisions)
})

// Write-only atom to switch variant (handles both single and comparison mode)
export const switchVariantAtom = atom(
    null,
    (
        get,
        set,
        {currentVariantId, newVariantId}: {currentVariantId: string; newVariantId: string},
    ) => {
        // Get current displayed variants from selectedVariantsAtom (direct state)
        const currentVariantIds = get(selectedVariantsAtom)

        if (currentVariantIds.length > 1) {
            // Comparison mode: Replace the current variant with the new one
            const updatedVariants = currentVariantIds.map((id) =>
                id === currentVariantId ? newVariantId : id,
            )
            set(selectedVariantsAtom, updatedVariants)
            set(urlRevisionsAtom, updatedVariants) // Keep URL in sync
            set(viewTypeAtom, "comparison")
        } else {
            // Single mode: Just switch to the new variant
            set(selectedVariantsAtom, [newVariantId])
            set(urlRevisionsAtom, [newVariantId]) // Keep URL in sync
            set(viewTypeAtom, "single")
        }
    },
)
