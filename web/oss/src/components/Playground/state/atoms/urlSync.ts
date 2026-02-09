import {atom} from "jotai"

import {duplicateChatHistoryForRevision} from "@/oss/state/generation/utils"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

import {selectedVariantsAtom} from "./core"

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

            duplicateChatHistoryForRevision({
                get,
                set,
                sourceRevisionId: currentVariantId,
                targetRevisionId: newVariantId,
                displayedVariantsAfterSwap: updatedVariants,
            })
            // Update the selection atom first, then sync to URL
            set(selectedVariantsAtom, updatedVariants)
            void writePlaygroundSelectionToQuery(updatedVariants)
        } else {
            // Single mode: Just switch to the new variant
            const updatedVariants = [newVariantId]

            duplicateChatHistoryForRevision({
                get,
                set,
                sourceRevisionId: currentVariantId,
                targetRevisionId: newVariantId,
                displayedVariantsAfterSwap: updatedVariants,
            })
            // Update the selection atom first, then sync to URL
            set(selectedVariantsAtom, updatedVariants)
            void writePlaygroundSelectionToQuery(updatedVariants)
        }
    },
)
