import {atom} from "jotai"

import {drawerVariantIdAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"

import {selectedVariantsAtom} from "./core"
import {updateUrlRevisionsAtom} from "./urlSync"
import {addVariantMutationAtom} from "./variantCrud"

/**
 * Additional variant CRUD mutations
 * These were extracted from the original enhancedVariantMutations.ts file
 */

// Alias for addVariantMutationAtom to maintain backward compatibility
export const createVariantMutationAtom = addVariantMutationAtom

// Remove variant from selection mutation
export const removeVariantFromSelectionMutationAtom = atom(null, (get, set, variantId: string) => {
    if (process.env.NODE_ENV === "development") {
        console.log("🗑️ removeVariantFromSelectionMutationAtom:", {variantId})
    }

    const currentSelected = get(selectedVariantsAtom)
    const updatedSelected = currentSelected.filter((id) => id !== variantId)

    // Update selection and URL (playground will read this)
    set(selectedVariantsAtom, updatedSelected)
    set(updateUrlRevisionsAtom, updatedSelected)

    // Keep drawer selection consistent
    const currentDrawerId = get(drawerVariantIdAtom)
    if (
        currentDrawerId === variantId ||
        !currentDrawerId ||
        !updatedSelected.includes(currentDrawerId)
    ) {
        set(drawerVariantIdAtom, updatedSelected[0] ?? null)
    }

    if (process.env.NODE_ENV === "development") {
        console.log("✅ Variant removed from selection:", {
            removed: variantId,
            remaining: updatedSelected,
        })
    }
})
