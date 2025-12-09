import {atom, Atom} from "jotai"

import {revisionListAtom} from "@/oss/components/Playground/state/atoms"
import {Variant} from "@/oss/lib/Types"
import {selectedVariantsAtom} from "@/oss/state/variant/atoms/selection"

// Global state for Variant Comparison Modal
export type VariantAtom = Atom<Variant[] | null>

interface ComparisonModalState {
    open: boolean
    compareListAtom?: VariantAtom
    allVariantsAtom?: VariantAtom
}

export const comparisonModalAtom = atom<ComparisonModalState>({
    open: false,
    compareListAtom: undefined,
    allVariantsAtom: undefined,
})

// Optional default selection scope used when no explicit compare list is provided
export const comparisonSelectionScopeAtom = atom<string | undefined>(undefined)

export const openComparisonModalAtom = atom(
    null,
    (
        get,
        set,
        params?:
            | {
                  compareListAtom: VariantAtom
                  allVariantsAtom?: VariantAtom
              }
            | {
                  compareList: Variant[]
                  allVariants?: Variant[]
              },
    ) => {
        const currentState = get(comparisonModalAtom)

        // Toggle: if already open, close it
        if (currentState.open) {
            set(comparisonModalAtom, {
                open: false,
                compareListAtom: undefined,
                allVariantsAtom: undefined,
            })
            return
        }

        let compareListAtom: VariantAtom | undefined
        let allVariantsAtom: VariantAtom | undefined

        if (params) {
            if ("compareListAtom" in params) {
                compareListAtom = params.compareListAtom
                allVariantsAtom = params.allVariantsAtom
            } else {
                compareListAtom = atom(params.compareList || [])
                allVariantsAtom = params.allVariants ? atom(params.allVariants) : undefined
            }
        }

        set(comparisonModalAtom, {
            open: true,
            compareListAtom,
            allVariantsAtom,
        })
    },
)

export const closeComparisonModalAtom = atom(null, (get, set) => {
    set(comparisonModalAtom, {
        open: false,
        compareListAtom: undefined,
        allVariantsAtom: undefined,
    })
})

export const comparisonModalCompareListAtom = atom((get) => {
    const state = get(comparisonModalAtom)
    if (state.compareListAtom) return get(state.compareListAtom)
    const scope = get(comparisonSelectionScopeAtom)
    if (scope) return get(selectedVariantsAtom(scope))
    // default to revisions list
    return get(revisionListAtom)
})

export const comparisonModalAllVariantsAtom = atom((get) => {
    const state = get(comparisonModalAtom)
    if (state.allVariantsAtom) return get(state.allVariantsAtom)
    return get(revisionListAtom)
})
