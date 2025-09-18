import {atom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {variantsAtom} from "@/oss/state/variant/atoms/fetcher"

import {selectedVariantsAtom, viewTypeAtom} from "./core"

/**
 * Phase 4.1: UI State Mutations
 * Atoms for managing UI state changes
 */

// Switch to single view with specific variant
export const setSelectedVariantMutationAtom = atom(null, (get, set, variantId: string) => {
    set(selectedVariantsAtom, [variantId])
    set(viewTypeAtom, "single")
})

// Add/remove variant from comparison view
export const toggleVariantDisplayMutationAtom = atom(
    null,
    (get, set, variantId: string, display?: boolean) => {
        const selected = get(selectedVariantsAtom)
        const shouldAdd = display ?? !selected.includes(variantId)

        if (shouldAdd) {
            const newSelected = [...selected, variantId]
            set(selectedVariantsAtom, newSelected)

            // Update view type based on selection count
            if (newSelected.length > 1) {
                set(viewTypeAtom, "comparison")
            } else {
                set(viewTypeAtom, "single")
            }

            // Get variant name for success message
            const variants = get(variantsAtom)
            const variant = variants.find((v) => v.id === variantId)
            const variantName = variant?.variantName || "Unknown"

            message.success(`Variant named ${variantName} added to comparison`)
        } else {
            const newSelected = selected.filter((id) => id !== variantId)
            set(selectedVariantsAtom, newSelected)

            // Update view type based on remaining selection
            set(viewTypeAtom, newSelected.length > 1 ? "comparison" : "single")

            // Get variant name for success message
            const variants = get(variantsAtom)
            const variant = variants.find((v) => v.id === variantId)
            const variantName = variant?.variantName || "Unknown"

            message.success(`Variant named ${variantName} removed from comparison`)
        }
    },
)

// Set multiple variants for comparison
export const setDisplayedVariantsMutationAtom = atom(null, (get, set, variantIds: string[]) => {
    set(selectedVariantsAtom, variantIds)
    set(viewTypeAtom, variantIds.length > 1 ? "comparison" : "single")
})
