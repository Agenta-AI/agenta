import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {recentRevisionsTableRowsAtom} from "@/oss/state/variant/selectors/variant"

// Holds selected row keys for a given table scope
export const variantTableSelectionAtomFamily = atomFamily((scopeId: string) =>
    atom<(string | number)[]>([]),
)

// Derives the selected variant objects for a given scope from the selected keys and the table rows source
export const selectedVariantsAtom = atomFamily((scopeId: string) =>
    atom((get) => {
        const keys = get(variantTableSelectionAtomFamily(scopeId))
        const all = get(recentRevisionsTableRowsAtom) as any[]
        return all.filter((v) => keys.includes(v.id))
    }),
)

// Lightweight derived count to avoid subscribing to the full selected array when only length is needed
export const selectedVariantsCountAtom = atomFamily((scopeId: string) =>
    atom((get) => get(variantTableSelectionAtomFamily(scopeId)).length),
)
