import {useMemo} from "react"

import {
    useTriggerDeliveries,
    useTriggerDeliveryPages,
    type TriggerDelivery,
} from "@agenta/entities/gatewayTrigger"

import {deliveryOutcome, useAutomationText, type Automation} from "./automationModel"
import {
    countRecentRuns,
    deliveriesOwner,
    runCountCaption,
    runFailureReason,
    sortRuns,
} from "./runModel"

/**
 * One automation's newest runs (at most 101, the capped recent read), plus the two facts the screens state about them: the count line
 * and why the last run failed.
 *
 * Reads the capped recent query (the newest 101 runs), so the card, the list row and the run
 * history heading share one cached request and one sentence. The full list pages on its own read
 * (`useAutomationRunPages`).
 *
 * The hook is inert without an automation: the deliveries endpoint is scoped by owner, and the
 * kind (schedule vs subscription) is only known once the automation resolves.
 */
export const useRecentAutomationRuns = (automation: Automation | null) => {
    const text = useAutomationText()
    const owner = useMemo(() => deliveriesOwner(automation), [automation])
    const {deliveries, isLoading, error, refetch} = useTriggerDeliveries(owner, {recent: true})

    const runs = useMemo<TriggerDelivery[]>(() => sortRuns(deliveries), [deliveries])
    const recentCount = useMemo(() => countRecentRuns(runs), [runs])

    // "The last run didn't finish" is what the screen says, so only the LAST run can raise it.
    // An older failure the automation has since recovered from is history, not a live fault.
    const failureReason = useMemo(() => {
        const newest = runs[0]
        if (!newest || deliveryOutcome(newest) !== "bad") return null
        return runFailureReason(newest)
    }, [runs, text])

    // A count is a claim. Before the automation resolves the query has no owner and never runs,
    // so `isLoading` is false with zero rows. Callers show the caption only once it is real.
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

/** Every run of one automation, newest first, a page at a time: the run history list. */
export const useAutomationRunPages = (automation: Automation | null) => {
    const owner = useMemo(() => deliveriesOwner(automation), [automation])
    const {deliveries, ...pages} = useTriggerDeliveryPages(owner)
    const runs = useMemo<TriggerDelivery[]>(() => sortRuns(deliveries), [deliveries])
    return {runs, ...pages}
}
