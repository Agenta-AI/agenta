import type {TriggerDelivery} from "@agenta/entities/gatewayTrigger"

import {deliveryOutcome} from "./automationModel"
import {runDayGroups, runOutcomeLabel, sortRuns, type RunDayGroup} from "./runModel"

/**
 * Narrow and group the run history — pure, like `runModel`, so the list renders what this
 * returns rather than deciding anything itself.
 *
 * Order is not offered: runs are newest-first everywhere in this app, and a run history read
 * bottom-up answers no question the day headings do not already answer.
 */

export type RunStatusFilter = "all" | "ok" | "bad" | "pending"
/** How the run started — the three things `runLabel` can call a row. */
export type RunTypeFilter = "all" | "scheduled" | "event" | "test"
export type RunGrouping = "day" | "none" | "status" | "type"

export interface RunListView {
    status: RunStatusFilter
    type: RunTypeFilter
    group: RunGrouping
}

export const DEFAULT_RUN_LIST_VIEW: RunListView = {
    status: "all",
    type: "all",
    group: "day",
}

const runListViewChanges = (view: RunListView): number =>
    (Object.keys(DEFAULT_RUN_LIST_VIEW) as (keyof RunListView)[]).filter(
        (key) => view[key] !== DEFAULT_RUN_LIST_VIEW[key],
    ).length

export const isDefaultRunListView = (view: RunListView): boolean => runListViewChanges(view) === 0

/** Which of the three types a delivery is — the same reading `runLabel` names it by. */
export function runType(delivery: TriggerDelivery): Exclude<RunTypeFilter, "all"> {
    if (delivery.data?.is_test) return "test"
    return delivery.schedule_id ? "scheduled" : "event"
}

export const RUN_TYPE_LABEL: Record<Exclude<RunTypeFilter, "all">, string> = {
    scheduled: "Scheduled",
    event: "Event",
    test: "Test run",
}

/** The rows the view asks for, still newest-first. */
export function deriveRunList(runs: TriggerDelivery[], view: RunListView): TriggerDelivery[] {
    return sortRuns(
        runs.filter((delivery) => {
            if (view.status !== "all" && statusKey(delivery) !== view.status) return false
            if (view.type !== "all" && runType(delivery) !== view.type) return false
            return true
        }),
    )
}

/**
 * The runs cut into the runs the view asked for.
 *
 * Day is the default because a row states only a time, and the heading above it is what makes
 * that time mean anything. `none` keeps one unlabelled run of rows — the list draws no heading
 * for a group that has no name.
 */
export function runGroups(runs: TriggerDelivery[], grouping: RunGrouping): RunDayGroup[] {
    if (grouping === "day") return runDayGroups(runs)
    if (grouping === "none") return runs.length ? [{key: "all", label: null, runs}] : []

    const buckets = new Map<string, RunDayGroup>()
    for (const delivery of runs) {
        const key =
            grouping === "status" ? statusKey(delivery) : (runType(delivery) as string)
        const label =
            grouping === "status"
                ? runOutcomeLabel(delivery).toUpperCase()
                : RUN_TYPE_LABEL[runType(delivery)].toUpperCase()
        const bucket = buckets.get(key)
        if (bucket) bucket.runs.push(delivery)
        else buckets.set(key, {key, label, runs: [delivery]})
    }
    return [...buckets.values()]
}

function statusKey(delivery: TriggerDelivery): RunStatusFilter {
    switch (deliveryOutcome(delivery)) {
        case "ok":
            return "ok"
        case "bad":
            return "bad"
        default:
            return "pending"
    }
}
