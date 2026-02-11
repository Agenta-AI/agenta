import {atom, Atom} from "jotai"

import {revisionListAtom} from "@/oss/components/Playground/state/atoms"

import {variantTableSelectionAtomFamily} from "../../../store/selectionAtoms"

/** Minimal revision shape used by the comparison modal */
export interface ComparisonRevision {
    id: string
    name?: string
    variantName?: string
    revision?: number | string
    parameters?: Record<string, unknown>
    createdAtTimestamp: number
    modifiedBy?: string
    createdBy?: string
    [key: string]: unknown
}

export type VariantAtom = Atom<ComparisonRevision[] | null>

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

// Atom that holds all available revisions for the current scope
// Set by the dashboard before opening the modal
export const comparisonAllRevisionsAtom = atom<ComparisonRevision[]>([])

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
                  compareList: ComparisonRevision[]
                  allVariants?: ComparisonRevision[]
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

export const closeComparisonModalAtom = atom(null, (_get, set) => {
    set(comparisonModalAtom, {
        open: false,
        compareListAtom: undefined,
        allVariantsAtom: undefined,
    })
})

/** Resolves the compare list: explicit atom > selection keys matched against all revisions > fallback */
export const comparisonModalCompareListAtom = atom((get) => {
    const state = get(comparisonModalAtom)
    if (state.compareListAtom) return get(state.compareListAtom)

    // Resolve from selection scope + available revisions
    const scope = get(comparisonSelectionScopeAtom)
    if (scope) {
        const keys = get(variantTableSelectionAtomFamily(scope))
        const all = get(comparisonAllRevisionsAtom)
        if (keys.length > 0 && all.length > 0) {
            const keySet = new Set(keys.map(String))
            return all.filter((r) => keySet.has(String(r.id)))
        }
    }

    // default to revisions list
    return get(revisionListAtom)
})

export const comparisonModalAllVariantsAtom = atom((get) => {
    const state = get(comparisonModalAtom)
    if (state.allVariantsAtom) return get(state.allVariantsAtom)
    const all = get(comparisonAllRevisionsAtom)
    if (all.length > 0) return all
    return get(revisionListAtom)
})
