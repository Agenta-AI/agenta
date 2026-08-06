import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

/** Holds selected row keys for a given table scope */
export const variantTableSelectionAtomFamily = atomFamily((_scopeId: string) =>
    atom<(string | number)[]>([]),
)

/** Lightweight derived count to avoid subscribing to the full selected array when only length is needed */
export const selectedVariantsCountAtom = atomFamily((scopeId: string) =>
    atom((get) => get(variantTableSelectionAtomFamily(scopeId)).length),
)
