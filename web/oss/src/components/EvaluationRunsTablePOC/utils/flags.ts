import {RunFlagsFilter} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations"

import type {FlagKey} from "../constants"

export const areFlagMapsEqual = (a?: RunFlagsFilter, b?: RunFlagsFilter) => {
    const aKeys = Object.keys(a ?? {})
    const bKeys = Object.keys(b ?? {})
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every(
        (key) =>
            (a as RunFlagsFilter)?.[key as FlagKey] === (b as RunFlagsFilter)?.[key as FlagKey],
    )
}
