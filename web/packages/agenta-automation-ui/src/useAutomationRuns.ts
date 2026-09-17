import {useMemo} from "react"

import {useTriggerDeliveries, type TriggerDelivery} from "@agenta/entities/gatewayTrigger"

import {deliveryOutcome, type Automation} from "./automationModel"
import {countRecentRuns, deliveriesOwner, runCountCaption, runError, sortRuns} from "./runModel"

/**
 * One automation's runs — the deliveries it produced, newest first, plus the two facts the
 * detail screen states about them.
 *
 * Shared by the detail screen and the run history so the caption on the card and the caption on
 * the screen it opens are the same sentence computed once, from the same query cache.
 *
 * The hook is inert without an automation: the deliveries endpoint is scoped by owner, and the
 * kind (schedule vs subscription) is only known once the automation resolves.
 */
export const useAutomationRuns = (automation: Automation | null) => {
    const owner = useMemo(() => deliveriesOwner(automation), [automation])
    const {deliveries, isLoading, error, refetch} = useTriggerDeliveries(owner)

    const runs = useMemo<TriggerDelivery[]>(() => sortRuns(deliveries), [deliveries])
    const recentCount = useMemo(() => countRecentRuns(runs), [runs])

    // "The last run didn't finish" is what the banner says, so only the LAST run can raise it.
    // An older failure the automation has since recovered from is history, not a live fault.
    const failureReason = useMemo(() => {
        const newest = runs[0]
        if (!newest || deliveryOutcome(newest) !== "bad") return null
        return runError(newest) ?? newest.status?.message ?? "The run failed."
    }, [runs])

    // A count is a claim. Before the automation resolves the query has no owner and never runs,
    // so `isLoading` is false with zero rows — reporting "0 runs" off that would be a lie told
    // confidently. Callers show the caption only once this says the number is real.
    const counted = Boolean(owner) && !isLoading && !error

    return {
        runs,
        recentCount,
        counted,
        caption: counted ? runCountCaption(recentCount) : "",
        failureReason,
        isLoading: Boolean(owner) && isLoading,
        error,
        refetch,
    }
}
