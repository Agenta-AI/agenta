import {atom} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"
import {variantsAtom} from "@/oss/state/variant/atoms/fetcher"

import {selectedVariantsAtom} from "./core"

// Add/remove variant from comparison view
export const toggleVariantDisplayMutationAtom = atom(
    null,
    (get, _set, variantId: string, display?: boolean) => {
        const selected = get(selectedVariantsAtom)
        const shouldAdd = display ?? !selected.includes(variantId)

        if (shouldAdd) {
            const newSelected = [...selected, variantId]
            void writePlaygroundSelectionToQuery(newSelected)

            // Get variant name for success message
            const variants = get(variantsAtom)
            const variant = variants.find((v) => v.id === variantId)
            const variantName = variant?.variantName || "Unknown"

            message.success(`Variant named ${variantName} added to comparison`)
        } else {
            const newSelected = selected.filter((id) => id !== variantId)
            void writePlaygroundSelectionToQuery(newSelected)

            // Get variant name for success message
            const variants = get(variantsAtom)
            const variant = variants.find((v) => v.id === variantId)
            const variantName = variant?.variantName || "Unknown"

            message.success(`Variant named ${variantName} removed from comparison`)
        }
    },
)

// Set multiple variants for comparison
export const setDisplayedVariantsMutationAtom = atom(null, (_get, _set, variantIds: string[]) => {
    void writePlaygroundSelectionToQuery(variantIds)
})
