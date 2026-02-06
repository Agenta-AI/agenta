import {atom} from "jotai"
import {loadable, atomFamily, selectAtom} from "jotai/utils"

import {variantsQueryAtom, variantRevisionsQueryFamily} from "@/oss/state/variant/atoms/fetcher"

import {appsListAtom, revisionsListAtomFamily} from "./variants"

/**
 * Phase 6.1: Non-Suspending Query Atoms
 * Loadable wrappers to prevent UI blocking during data fetching
 *
 * WP-6.5: Updated to use molecule-backed list atoms where possible
 */

// Non-suspending variant of variantsQueryAtom (legacy - kept for backward compatibility)
export const variantsLoadableAtom = loadable(variantsQueryAtom)

// WP-6.5: Molecule-backed apps list loading state
export const appsListLoadingAtom = selectAtom(
    appsListAtom,
    (state) => state.isPending ?? false,
    Object.is,
)

export const appsListHasDataAtom = selectAtom(
    appsListAtom,
    (state) => (state.data?.length ?? 0) > 0,
    Object.is,
)

// Lightweight selectors for status-only subscriptions (legacy - kept for backward compatibility)
export const variantsIsLoadingAtom = selectAtom(variantsLoadableAtom, (v) => v.state === "loading")
export const variantsHasDataAtom = selectAtom(variantsLoadableAtom, (v) => v.state === "hasData")
export const variantsErrorAtom = selectAtom(
    variantsLoadableAtom,
    (v) => (v.state === "hasError" ? v.error : null),
    Object.is,
)

// Loadable revisions per variant (legacy - kept for backward compatibility)
export const variantRevisionsLoadableFamily = atomFamily((variantId: string) =>
    loadable(variantRevisionsQueryFamily(variantId)),
)

// WP-6.5: Molecule-backed revisions list loading state
export const revisionsListLoadingAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        const listAtom = revisionsListAtomFamily(variantId)
        if (!listAtom) return false
        const state = get(listAtom)
        return (state as any)?.isPending ?? false
    }),
)

export const revisionsListHasDataAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        const listAtom = revisionsListAtomFamily(variantId)
        if (!listAtom) return false
        const state = get(listAtom)
        return ((state as any)?.data?.length ?? 0) > 0
    }),
)

/**
 * Phase 6.3: Optimistic UI Updates
 * Atoms for immediate UI updates with error rollback
 */

export interface VariantUpdate {
    variantId: string
    changes: Partial<any> // Will be properly typed based on variant structure
}
