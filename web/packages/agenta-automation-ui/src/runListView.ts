import type {TriggerDelivery} from "@agenta/entities/gatewayTrigger"

import {deliveryOutcome} from "./automationModel"
import {sortRuns} from "./runModel"

/**
 * Narrow and order the run history — pure, like `runModel`, so the list renders what this
 * returns rather than deciding anything itself.
 *
 * There is no grouping here on purpose: the day headings are the list's presentation, not a
 * choice (a row states only a time, and the heading above it is what makes that time mean
 * anything), so the menu over this offers no Group row.
 */

export type RunOutcomeFilter = "all" | "ok" | "bad" | "pending"
/** How the run started — the three things `runLabel` can call a row. */
export type RunKindFilter = "all" | "scheduled" | "event" | "test"
export type RunSort = "newest" | "oldest"

export interface RunListView {
    outcome: RunOutcomeFilter
    kind: RunKindFilter
    sort: RunSort
}

export const DEFAULT_RUN_LIST_VIEW: RunListView = {
    outcome: "all",
    kind: "all",
    sort: "newest",
}

const runListViewChanges = (view: RunListView): number =>
    (Object.keys(DEFAULT_RUN_LIST_VIEW) as (keyof RunListView)[]).filter(
        (key) => view[key] !== DEFAULT_RUN_LIST_VIEW[key],
    ).length

export const isDefaultRunListView = (view: RunListView): boolean => runListViewChanges(view) === 0

/** Which of the three kinds a delivery is — the same reading `runLabel` names it by. */
export function runKind(delivery: TriggerDelivery): Exclude<RunKindFilter, "all"> {
    if (delivery.data?.is_test) return "test"
    return delivery.schedule_id ? "scheduled" : "event"
}

export function deriveRunList(runs: TriggerDelivery[], view: RunListView): TriggerDelivery[] {
    const narrowed = runs.filter((delivery) => {
        if (view.outcome !== "all" && outcomeKey(delivery) !== view.outcome) return false
        if (view.kind !== "all" && runKind(delivery) !== view.kind) return false
        return true
    })

    // `sortRuns` is the newest-first order every other surface here reads; oldest is that
    // reversed rather than a second comparator that could drift from it.
    const ordered = sortRuns(narrowed)
    return view.sort === "oldest" ? ordered.reverse() : ordered
}

function outcomeKey(delivery: TriggerDelivery): RunOutcomeFilter {
    switch (deliveryOutcome(delivery)) {
        case "ok":
            return "ok"
        case "bad":
            return "bad"
        default:
            return "pending"
    }
}
