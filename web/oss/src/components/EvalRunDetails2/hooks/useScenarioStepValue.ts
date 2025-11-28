import {useMemo} from "react"

import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    buildColumnValueConfig,
    scenarioColumnValueAtomFamily,
    scenarioColumnValueSelectionAtomFamily,
    type ScenarioColumnValueSelection,
    type ScenarioStepValueResult,
} from "../atoms/scenarioColumnValues"
import type {EvaluationTableColumn} from "../atoms/table"

export function useScenarioStepValue(
    {
        scenarioId,
        runId,
        column,
    }: {
        scenarioId?: string
        runId?: string
        column: EvaluationTableColumn
    },
    options?: {enabled?: boolean},
): ScenarioStepValueResult {
    const enabled = options?.enabled ?? true
    const columnConfig = useMemo(() => buildColumnValueConfig(column, {enabled}), [column, enabled])
    const valueAtom = useMemo(
        () => scenarioColumnValueAtomFamily({scenarioId, runId, column: columnConfig}),
        [scenarioId, runId, columnConfig],
    )

    const x = useAtomValueWithSchedule(valueAtom, {priority: LOW_PRIORITY})
    console.log("useScenarioStepValue", x)
    return x
}

export function useScenarioStepValueSelection(
    {
        scenarioId,
        runId,
        column,
    }: {
        scenarioId?: string
        runId?: string
        column: EvaluationTableColumn
    },
    options?: {enabled?: boolean},
): ScenarioColumnValueSelection {
    const enabled = options?.enabled ?? true
    const columnConfig = useMemo(() => buildColumnValueConfig(column, {enabled}), [column, enabled])
    const selectionAtom = useMemo(
        () => scenarioColumnValueSelectionAtomFamily({scenarioId, runId, column: columnConfig}),
        [scenarioId, runId, columnConfig],
    )

    return useAtomValueWithSchedule(selectionAtom, {priority: LOW_PRIORITY})
}

export type {ScenarioStepValueResult} from "../atoms/scenarioColumnValues"
