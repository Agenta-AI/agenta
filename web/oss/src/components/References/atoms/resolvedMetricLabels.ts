import {atom} from "jotai"
import {atomFamily} from "jotai-family"

export const resolvedMetricLabelsAtomFamily = atomFamily(
    (descriptorId: string) => atom<string | null>(null),
    (a, b) => a === b,
)
