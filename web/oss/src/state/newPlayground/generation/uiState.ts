import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

// Key format: `${rowId}:${variantId}`
export const repetitionIndexAtomFamily = atomFamily((key: string) => atom<number>(0))
