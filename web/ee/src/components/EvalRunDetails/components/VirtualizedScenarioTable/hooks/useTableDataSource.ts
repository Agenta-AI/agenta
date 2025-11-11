import {useMemo} from "react"

import deepEqual from "fast-deep-equal"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import groupBy from "lodash/groupBy"

import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import {useRunId} from "@/oss/contexts/RunIdContext"
import {ColumnDef} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"

import {
    evaluationRunStateFamily,
    runIndexFamily,
} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedAtoms"
// import {scenarioMetricsMapFamily} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {
    displayedScenarioIdsFamily,
    loadableScenarioStepFamily,
} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedScenarios"
import {evalAtomStore} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/store"
import {buildScenarioTableData, buildScenarioTableRows} from "../assets/dataSourceBuilder"
import {buildAntdColumns} from "../assets/utils"

const EMPTY_SCENARIOS: any[] = []

export const editColumnsFamily = atomFamily((runId: string) => atom<string[]>([]), deepEqual)

// Convert to atom family for run-scoped access
export const allScenariosLoadedFamily = atomFamily(
    (runId: string) =>
        atom(
            (get) =>
                (get(evaluationRunStateFamily(runId)).scenarios || EMPTY_SCENARIOS).map(
                    (s: any) => s.id,
                )?.length > 0,
        ),
    deepEqual,
)

// Run-scoped metrics from evaluators atom family
export const metricsFromEvaluatorsFamily = atomFamily(
    (runId: string) =>
        selectAtom(
            evaluationRunStateFamily(runId),
            (state) => {
                const evs = state?.enrichedRun?.evaluators
                    ? Object.values(state.enrichedRun.evaluators)
                    : []
                if (!evs || !Array.isArray(evs)) {
                    return {}
                }
                return groupBy(
                    evs.reduce((acc: any[], ev: any) => {
                        return [
                            ...acc,
                            ...Object.entries(ev.metrics || {}).map(
                                ([metricName, metricInfo]: [string, any]) => {
                                    return {
                                        [metricName]: {
                                            metricType: metricInfo.type,
                                        },
                                        evaluatorSlug: ev.slug,
                                    }
                                },
                            ),
                        ]
                    }, []),
                    (def: any) => {
                        return def.evaluatorSlug
                    },
                )
            },
            deepEqual,
        ),
    deepEqual,
)

const useTableDataSource = () => {
    const runId = useRunId()
    const store = evalAtomStore()

    // states
    const [editColumns, setEditColumns] = useAtom(editColumnsFamily(runId), {store})

    // Read from the same global store that writes are going to
    const scenarioIds = useAtomValue(displayedScenarioIdsFamily(runId), {store}) || EMPTY_SCENARIOS
    const allScenariosLoaded = useAtomValue(allScenariosLoadedFamily(runId), {store})

    // const metricDistributions = useAtomValue(runMetricsStatsAtom)
    const runIndex = useAtomValue(runIndexFamily(runId))
    const metricsFromEvaluators =
        useAtomValue(metricsFromEvaluatorsFamily(runId)) || EMPTY_SCENARIOS
    // temporary implementation to implement loading state for auto eval
    const loadable = useAtomValue(loadableScenarioStepFamily({runId, scenarioId: scenarioIds?.[0]}))
    const evaluationRunState = useAtomValue(evaluationRunStateFamily(runId), {store})
    const evaluators = evaluationRunState?.enrichedRun?.evaluators || []

    const isLoadingSteps = useMemo(
        () => loadable.state === "loading" || !allScenariosLoaded,
        [loadable, allScenariosLoaded],
    )

    const rows = useMemo(() => {
        return buildScenarioTableRows({
            scenarioIds,
            allScenariosLoaded,
            runId,
        })
    }, [scenarioIds, allScenariosLoaded])

    // New alternative data source built via shared helper
    const builtColumns: ColumnDef[] = useMemo(
        () =>
            buildScenarioTableData({
                runIndex,
                runId,
                metricsFromEvaluators,
                evaluators,
            }),
        [runIndex, runId, metricsFromEvaluators, evaluators],
    )

    // Build Ant Design columns and make them resizable
    const antColumns = useMemo(() => {
        return buildAntdColumns(builtColumns, runId, {})
    }, [builtColumns, runId])

    const visibleColumns = useMemo(
        () => filterColumns(antColumns, editColumns),
        [antColumns, editColumns],
    )

    const totalColumnWidth = useMemo(() => {
        const calc = (cols: any[]): number =>
            cols.reduce((sum, col) => {
                if (col?.children && col?.children.length) {
                    return sum + calc(col?.children)
                }
                return sum + (col?.width ?? col?.minWidth ?? 100)
            }, 0)
        return calc(antColumns)
    }, [antColumns])

    return {
        rawColumns: antColumns,
        antColumns: visibleColumns,
        rows,
        totalColumnWidth,
        isLoadingSteps,
        editColumns,
        setEditColumns,
    }
}

export default useTableDataSource
