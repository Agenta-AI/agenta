import {useMemo} from "react"

import {useProjectTriggerDeliveries} from "@agenta/entities/gatewayTrigger"

import {automationStatus, deliveryOutcome, type Automation} from "./automationModel"

/** The window the outcome counts are taken over, and the only one the cards claim. */
export const STATS_WINDOW_DAYS = 7

export interface AutomationStats {
    /** All automations that exist, of either kind — not windowed. */
    total: number
    /** How many of them are on. The rest are stopped, which is a choice, not a fault. */
    working: number
    succeeded: number
    failed: number
    /**
     * The window held more than one page of deliveries, so the outcome counts are floors.
     * The cards say so rather than printing a number that is quietly short.
     */
    truncated: boolean
    /** Both halves have answered. A count rendered before this is a guess. */
    ready: boolean
}

/**
 * The three numbers above the automations list.
 *
 * They come from two places on purpose: how many automations exist — and how many of those are
 * on — is a fact about the list already on screen, so the rows are passed in rather than
 * refetched, while the outcome counts need the project's deliveries — one windowed query,
 * counted here.
 *
 * "Working" is read through `automationStatus`, the same call the table's Status column makes, so
 * the headline and the column below it can never disagree about what is running.
 *
 * Counting is client-side because the split is not queryable: an outcome lives in
 * `status.message` ("success" / "failed" / "dispatched") and the endpoint filters only on
 * `status.code`. `deliveryOutcome` is the same reader the run rows use, so a run that shows a red
 * dot in a history is the one counted as failed here.
 *
 * The two halves do not share a denominator — the total is all-time and the outcomes are the last
 * seven days — which is why every card states its own window in its label.
 */
export const useAutomationStats = (automations: Automation[]): AutomationStats => {
    const {deliveries, truncated, isLoading, error} = useProjectTriggerDeliveries(STATS_WINDOW_DAYS)

    const working = useMemo(
        // No delivery history is read per row here, so nothing claims a recent failure: this
        // separates on from stopped, which is the only split the card states.
        () => automations.filter((a) => automationStatus(a, false) === "working").length,
        [automations],
    )

    const {succeeded, failed} = useMemo(() => {
        let ok = 0
        let bad = 0
        for (const delivery of deliveries) {
            const outcome = deliveryOutcome(delivery)
            // "dispatched" is neither: a run still in flight has not earned a column.
            if (outcome === "ok") ok += 1
            else if (outcome === "bad") bad += 1
        }
        return {succeeded: ok, failed: bad}
    }, [deliveries])

    return {
        total: automations.length,
        working,
        succeeded,
        failed,
        truncated,
        ready: !isLoading && !error,
    }
}
