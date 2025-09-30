import {loadable, atomFamily, selectAtom} from "jotai/utils"

import {variantsQueryAtom, variantRevisionsQueryFamily} from "@/oss/state/variant/atoms/fetcher"

/**
 * Phase 6.1: Non-Suspending Query Atoms
 * Loadable wrappers to prevent UI blocking during data fetching
 */

// Non-suspending variant of variantsQueryAtom
export const variantsLoadableAtom = loadable(variantsQueryAtom)

// Lightweight selectors for status-only subscriptions
export const variantsIsLoadingAtom = selectAtom(variantsLoadableAtom, (v) => v.state === "loading")
export const variantsHasDataAtom = selectAtom(variantsLoadableAtom, (v) => v.state === "hasData")
export const variantsErrorAtom = selectAtom(
    variantsLoadableAtom,
    (v) => (v.state === "hasError" ? v.error : null),
    Object.is,
)

// Loadable revisions per variant
export const variantRevisionsLoadableFamily = atomFamily((variantId: string) =>
    loadable(variantRevisionsQueryFamily(variantId)),
)

/**
 * Phase 6.3: Optimistic UI Updates
 * Atoms for immediate UI updates with error rollback
 */

export interface VariantUpdate {
    variantId: string
    changes: Partial<any> // Will be properly typed based on variant structure
}
