import {
    unwrapCategoricalStats,
    unwrapStatsForCompare,
    type RunColumnGroup,
} from "@agenta/entities/evaluationRun/etl"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

/** The whole scenario as data, as the old app's JSON view and its copy button give it. */
export interface ScenarioPayload {
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
    /** Each evaluator's values by its name, or its error when it failed. */
    evaluators: Record<string, unknown>
}

/** A value with no answer yet is written as null, so its key still shows. */
const plain = (value: unknown) => (value === undefined ? null : value)

/**
 * Named values as one object. A name that repeats (two apps of one run both write `outputs`)
 * gets " 2", " 3" after it, so no value hides another. A name that does not repeat keeps its
 * name: the numbering skips every name in the list, and a name such as `constructor` is a name,
 * not an inherited property.
 */
export function valuesByName(entries: readonly (readonly [string, unknown])[]) {
    const names = new Set(entries.map(([name]) => name))
    const values = new Map<string, unknown>()
    for (const [name, value] of entries) {
        let key = name
        for (let n = 2; values.has(key) || (key !== name && names.has(key)); n++) {
            key = `${name} ${n}`
        }
        values.set(key, value)
    }
    return Object.fromEntries(values)
}

/**
 * An evaluator value: a category as its label, else the stats' value. A single choice reads as
 * its label; a multiple choice stays a list, also with one label.
 */
const metricValue = (value: unknown) => {
    const labels = unwrapCategoricalStats(value)
    if (labels === null) return unwrapStatsForCompare(value)
    const multiple = (value as {type?: unknown}).type === "categorical/multiple"
    return labels.length === 1 && !multiple ? labels[0] : labels
}

/**
 * The values of one scenario by kind: the test case inputs, the app outputs, and each
 * evaluator's values (a one-row score summary reads as the score itself).
 */
export function scenarioPayload(
    row: ScenarioRow,
    groups: RunColumnGroup[],
    labels: Record<string, string>,
): ScenarioPayload {
    const valuesOf = (kind: string, read: (value: unknown) => unknown = plain) =>
        valuesByName(
            groups
                .filter(({group}) => group.kind === kind)
                .flatMap(({group}) => row.cells[group.key] ?? [])
                .map((cell) => [cell.name, read(cell.value)] as const),
        )
    const evaluators = Object.fromEntries(
        groups
            .filter(({group}) => group.kind === "evaluator")
            .map(({group}) => {
                const error = row.errors[group.key]
                const values = Object.fromEntries(
                    (row.cells[group.key] ?? []).map((cell) => [
                        cell.name,
                        plain(metricValue(cell.value)),
                    ]),
                )
                return [labels[group.key] ?? group.label, error ? {error} : values]
            }),
    )
    return {inputs: valuesOf("testset"), outputs: valuesOf("application"), evaluators}
}

/** What the Raw view of each drawer tab shows: its own part of the test case. */
export function scenarioTabPayload(
    payload: ScenarioPayload,
    tab: "io" | "results" | "metadata",
    row: ScenarioRow,
): unknown {
    if (tab === "io") return {inputs: payload.inputs, outputs: payload.outputs}
    if (tab === "results") return {evaluators: payload.evaluators}
    return {
        status: row.invocation?.status ?? null,
        metrics: row.metrics,
        testcase_id: row.testcaseId,
        scenario_id: row.scenario.id,
        trace_id: row.invocation?.traceId ?? null,
    }
}
