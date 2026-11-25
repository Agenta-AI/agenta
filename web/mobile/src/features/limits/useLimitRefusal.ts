import {useCallback, useState} from "react"

import {isBillingEnabled} from "@agenta/shared/api"

import {isAtLimit, type InstanceLimitUsage} from "../settings/licenseApi"

import type {LimitRefusal} from "./limitRefusal"

/**
 * A limit refusal after submit, held until a usage read made after it shows room again: a key
 * activated in another tab, or a usage read that had failed, must not leave Create off. Self-hosted
 * only reads the usage; on cloud the refusal stays until the dialog clears it.
 */
export const useLimitRefusal = (
    usage: {isSuccess: boolean; dataUpdatedAt: number; refetch: () => unknown},
    current: InstanceLimitUsage | null | undefined,
) => {
    const [stored, setStored] = useState<{refusal: LimitRefusal; at: number} | null>(null)
    const lifted =
        stored !== null &&
        usage.isSuccess &&
        usage.dataUpdatedAt >= stored.at &&
        !isAtLimit(current)

    const {refetch} = usage
    /** Hold the refusal and read the usage again. */
    const refuse = useCallback(
        (refusal: LimitRefusal) => {
            setStored({refusal, at: Date.now()})
            if (!isBillingEnabled()) void refetch()
        },
        [refetch],
    )
    const clear = useCallback(() => setStored(null), [])

    return {refusal: lifted ? null : (stored?.refusal ?? null), refuse, clear}
}
