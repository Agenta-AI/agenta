import {atom} from "jotai"

import {playgroundConfigAtom} from "../core/config"
import type {DirtyState} from "../types"

import {selectedVariantRequestBodyAtom, displayedVariantsRequestBodiesAtom} from "./requestBody"

/**
 * Validation and Dirty State Atoms
 *
 * These atoms handle dirty state detection and validation.
 * Optimized equality checks comparing derived vs original revision state.
 */

// Check if a variant is dirty (modified from original revision)
export const isVariantDirtyAtom = atom(null, (get, set, variantId: string): DirtyState => {
    const config = get(playgroundConfigAtom)
    const variant = config.variants[variantId]

    if (!variant) {
        return {
            variantId,
            isDirty: false,
            changes: [],
        }
    }

    // If no original revision, it's a new variant (dirty)
    if (!variant.metadata.originalRevisionId) {
        return {
            variantId,
            isDirty: true,
            changes: ["New variant"],
        }
    }

    // TODO: Compare with original revision from revisions atom
    // For now, check if updatedAt > createdAt
    const isDirty = variant.metadata.updatedAt > variant.metadata.createdAt

    return {
        variantId,
        isDirty,
        changes: isDirty ? ["Modified"] : [],
    }
})

// Check if selected variant is dirty
export const isSelectedVariantDirtyAtom = atom((get) => {
    const config = get(playgroundConfigAtom)
    if (!config.selectedVariantId) return false

    const dirtyCheck = get(isVariantDirtyAtom)
    return dirtyCheck ? dirtyCheck.isDirty : false
})

// Check if any displayed variant is dirty
export const hasAnyDirtyVariantAtom = atom((get) => {
    const config = get(playgroundConfigAtom)
    const dirtyCheck = get(isVariantDirtyAtom)

    return config.displayedVariantIds.some((variantId) => {
        const result = dirtyCheck ? dirtyCheck : {isDirty: false}
        return result.isDirty
    })
})
