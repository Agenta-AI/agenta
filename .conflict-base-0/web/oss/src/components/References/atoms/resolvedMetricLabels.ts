import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

export const resolvedMetricLabelsAtomFamily = atomFamily(
    (descriptorId: string) => atom<string | null>(null),
    (a, b) => a === b,
)
