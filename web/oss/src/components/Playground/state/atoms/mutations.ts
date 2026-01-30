import {message} from "@agenta/ui/app-message"
import {atom} from "jotai"

import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

import {selectedVariantsAtom} from "./core"
import {revisionListAtom} from "./variants"

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
            const revisions = get(revisionListAtom) as any[]
            const revision = revisions.find((rev) => rev.id === variantId)
            const variantName = revision?.variantName || "Unknown"

            message.success(`Variant named ${variantName} added to comparison`)
        } else {
            const newSelected = selected.filter((id) => id !== variantId)
            void writePlaygroundSelectionToQuery(newSelected)

            // Get variant name for success message
            const revisions = get(revisionListAtom) as any[]
            const revision = revisions.find((rev) => rev.id === variantId)
            const variantName = revision?.variantName || "Unknown"

            message.success(`Variant named ${variantName} removed from comparison`)
        }
    },
)

// Set multiple variants for comparison
export const setDisplayedVariantsMutationAtom = atom(null, (_get, _set, variantIds: string[]) => {
    void writePlaygroundSelectionToQuery(variantIds)
})
