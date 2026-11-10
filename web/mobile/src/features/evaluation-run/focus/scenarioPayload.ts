import {unwrapStatsForCompare, type RunColumnGroup} from "@agenta/entities/evaluationRun/etl"

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
 * The values of one scenario by kind: the test case inputs, the app outputs, and each
 * evaluator's values (a one-row score summary reads as the score itself).
 */
export function scenarioPayload(
    row: ScenarioRow,
    groups: RunColumnGroup[],
    labels: Record<string, string>,
): ScenarioPayload {
    const valuesOf = (kind: string, read: (value: unknown) => unknown = plain) =>
        Object.fromEntries(
            groups
                .filter(({group}) => group.kind === kind)
                .flatMap(({group}) => row.cells[group.key] ?? [])
                .map((cell) => [cell.name, read(cell.value)]),
        )
    const evaluators = Object.fromEntries(
        groups
            .filter(({group}) => group.kind === "evaluator")
            .map(({group}) => {
                const error = row.errors[group.key]
                const values = Object.fromEntries(
                    (row.cells[group.key] ?? []).map((cell) => [
                        cell.name,
                        plain(unwrapStatsForCompare(cell.value)),
                    ]),
                )
                return [labels[group.key] ?? group.label, error ? {error} : values]
            }),
    )
    return {inputs: valuesOf("testset"), outputs: valuesOf("application"), evaluators}
}
