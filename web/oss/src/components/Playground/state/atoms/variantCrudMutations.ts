import {atom} from "jotai"

import {drawerVariantIdAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {discardLocalDraft, isLocalDraft} from "@/oss/state/newPlayground/legacyEntityBridge"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

import {selectedVariantsAtom} from "./core"
import {addVariantMutationAtom} from "./variantCrud"

/**
 * Additional variant CRUD mutations
 * These were extracted from the original enhancedVariantMutations.ts file
 */

// Alias for addVariantMutationAtom to maintain backward compatibility
export const createVariantMutationAtom = addVariantMutationAtom

// Remove variant from selection mutation
export const removeVariantFromSelectionMutationAtom = atom(null, (get, set, variantId: string) => {
    const currentSelected = get(selectedVariantsAtom)
    const updatedSelected = currentSelected.filter((id) => id !== variantId)

    // Keep selection state in sync even if URL doesn't change (e.g., local draft removal)
    set(selectedVariantsAtom, updatedSelected)

    // Update selection and URL (playground will read this)
    void writePlaygroundSelectionToQuery(updatedSelected)

    // Keep drawer selection consistent
    const currentDrawerId = get(drawerVariantIdAtom)
    if (
        currentDrawerId === variantId ||
        !currentDrawerId ||
        !updatedSelected.includes(currentDrawerId)
    ) {
        set(drawerVariantIdAtom, updatedSelected[0] ?? null)
    }

    // If removing a local draft, discard its data from the molecule
    if (isLocalDraft(variantId)) {
        discardLocalDraft(variantId)
    }
})
