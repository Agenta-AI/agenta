import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

export const resolvedMetricPathsAtomFamily = atomFamily(
    (descriptorId: string) => atom<Record<string, string>>({}),
    (a, b) => a === b,
)
