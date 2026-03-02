import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {appsListAtom, revisionsListAtomFamily} from "./variants"

/**
 * Non-Suspending Query Atoms
 * Loadable wrappers to prevent UI blocking during data fetching
 */

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

export interface VariantUpdate {
    variantId: string
    changes: Partial<any> // Will be properly typed based on variant structure
}
