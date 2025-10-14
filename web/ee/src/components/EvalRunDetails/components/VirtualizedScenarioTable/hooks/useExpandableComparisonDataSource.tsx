import {useMemo} from "react"

import deepEqual from "fast-deep-equal"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    evalAtomStore,
    evaluationRunStateFamily,
    runIndexFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {filterColumns} from "@/oss/components/Filters/EditColumns/assets/helper"
import type {RunIndex} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"

import {
    displayedScenarioIdsFamily,
    scenarioStepsFamily,
} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedScenarios"
import {buildScenarioTableData} from "../assets/dataSourceBuilder"
import {buildAntdColumns} from "../assets/utils"
import {expendedRowAtom} from "../ComparisonScenarioTable"
import type {TableColumn} from "../assets/types"
import {editColumnsFamily} from "./useTableDataSource"

export interface GroupedScenario {
    key: string
    scenarioId: string
    testcaseId: string
    inputs: any
    outputs: any
    runId: string
    comparedScenarios: {
        id: string
        inputSteps: string
        inputs: any
        outputs: any
        runId: string
    }[]
}

interface UseExpandableComparisonDataSourceProps {
    baseRunId: string
    comparisonRunIds: string[]
}

const testcaseForScenarios = atomFamily((runId: string) =>
    atom((get) => {
        const scenarioSteps = get(scenarioStepsFamily(runId))
        const allScenarioIds = Object.keys(scenarioSteps)
        const allSteps = allScenarioIds.reduce((acc, scenarioId) => {
            const scenarioTestcaseIds = scenarioSteps[scenarioId]?.data?.inputSteps?.map(
                (s) => s?.testcaseId,
            )
            acc[scenarioId] = scenarioTestcaseIds
            return acc
        }, {})
        return allSteps
    }),
)
export const comparisonRunsStepsAtom = atomFamily((runIds: string[]) =>
    atom((get) => {
        const steps = runIds.reduce((acc, runId) => {
            const scenarioSteps = get(scenarioStepsFamily(runId))

            const allStepIds = Object.keys(scenarioSteps)
            const allSteps = allStepIds.map((stepId) => ({
                id: stepId,
                ...scenarioSteps[stepId],
            }))
            const allStepsData = allSteps.reduce((acc, step) => {
                if (step.state === "hasData") {
                    acc[step.id] = step?.data?.inputSteps?.map((s) => s?.testcaseId)
                }
                return acc
            }, {})

            acc[runId] = allStepsData
            return acc
        }, {})
        return steps
    }),
)

export const comparisonRunIndexesAtom = atomFamily(
    (runIds: string[]) =>
        atom((get) =>
            runIds.reduce<Record<string, RunIndex | null | undefined>>((acc, runId) => {
                acc[runId] = get(runIndexFamily(runId))
                return acc
            }, {}),
        ),
    deepEqual,
)

const comparisonRunsEvaluatorsAtom = atomFamily((runIds: string[]) =>
    atom((get) => {
        const evaluators = new Set()
        runIds.forEach((runId) => {
            const evals = get(evaluationRunStateFamily(runId))
            const enrichRun = evals?.enrichedRun
            if (enrichRun) {
                enrichRun.evaluators?.forEach((e) => evaluators.add(e))
            }
        })

        return Array.from(evaluators)
    }),
)

const metricsFromEvaluatorsFamily = atomFamily(
    (runIds: string[]) =>
        atom((get) => {
            // Build a map of evaluatorSlug -> unique metrics
            const result: Record<string, any[]> = {}
            const seenMetricBySlug: Record<string, Set<string>> = {}

            runIds.forEach((runId) => {
                const state = get(evaluationRunStateFamily(runId))
                const evaluators = state?.enrichedRun?.evaluators
                    ? Object.values(state.enrichedRun.evaluators)
                    : []

                evaluators.forEach((ev: any) => {
                    const slug = ev?.slug
                    if (!slug) return

                    if (!seenMetricBySlug[slug]) {
                        seenMetricBySlug[slug] = new Set<string>()
                    }

                    if (ev?.metrics && typeof ev.metrics === "object") {
                        Object.entries(ev.metrics).forEach(
                            ([metricName, metricInfo]: [string, any]) => {
                                if (seenMetricBySlug[slug].has(metricName)) return
                                seenMetricBySlug[slug].add(metricName)

                                if (!result[slug]) result[slug] = []
                                result[slug].push({
                                    [metricName]: {
                                        metricType: metricInfo?.type || "unknown",
                                    },
                                    evaluatorSlug: slug,
                                })
                            },
                        )
                    }
                })
            })

            return result
        }),
    deepEqual,
)

const useExpandableComparisonDataSource = ({
    baseRunId,
    comparisonRunIds,
}: UseExpandableComparisonDataSourceProps) => {
    const store = evalAtomStore()
    // const fetchMultipleRuns = useSetAtom(multiRunDataFetcherAtom)

    const comparisonRunsSteps = useAtomValue(comparisonRunsStepsAtom(comparisonRunIds), {store})
    const baseTestcases = useAtomValue(testcaseForScenarios(baseRunId), {store})
    const comparisonRunIndexes = useAtomValue(comparisonRunIndexesAtom(comparisonRunIds), {store})

    const comparisonRunsEvaluators = useAtomValue(comparisonRunsEvaluatorsAtom(comparisonRunIds), {
        store,
    })

    const metricsFromEvaluators = useAtomValue(
        metricsFromEvaluatorsFamily([baseRunId, ...comparisonRunIds]),
        {store},
    )

    // Match scenarios by content rather than IDs
    const matchedScenarios = useMemo(() => {
        const matches: Record<string, any[]> = {}

        // For each base scenario, find matching scenarios in comparison runs
        Object.entries(baseTestcases as Record<string, any>).forEach(
            ([baseScenarioId, baseSteps]) => {
                const baseTestcaseData = baseSteps?.[0]
                if (!baseTestcaseData) return

                const comparedScenarios: any[] = []

                // Search through all comparison runs
                Object.entries(comparisonRunsSteps as Record<string, any>).forEach(
                    ([compRunId, compScenarios]) => {
                        Object.entries(compScenarios as Record<string, any>).forEach(
                            ([compScenarioId, compSteps]) => {
                                const compTestcaseData = compSteps?.[0]
                                if (!compTestcaseData) return

                                const inputsMatch = baseTestcaseData === compTestcaseData

                                if (inputsMatch) {
                                    // Derive compareIndex for this run from state or fallback to order in comparisonRunIds
                                    const compState = store.get(evaluationRunStateFamily(compRunId))
                                    const compareIndex =
                                        compState?.compareIndex ??
                                        (comparisonRunIds.includes(compRunId)
                                            ? comparisonRunIds.indexOf(compRunId) + 2
                                            : undefined)
                                    comparedScenarios.push({
                                        matchedTestcaseId: compTestcaseData,
                                        runId: compRunId,
                                        scenarioId: compScenarioId,
                                        compareIndex,
                                    })
                                }
                            },
                        )
                    },
                )

                matches[baseScenarioId] = comparedScenarios
            },
        )

        return matches
    }, [baseTestcases, comparisonRunsSteps, comparisonRunIds.join(",")])

    // Build columns using EXACT same approach as regular table (useTableDataSource)
    const runIndex = useAtomValue(runIndexFamily(baseRunId), {store})
    const evaluationRunState = useAtomValue(evaluationRunStateFamily(baseRunId), {store})
    const expendedRows = useAtomValue(expendedRowAtom)
    const evaluators = evaluationRunState?.enrichedRun?.evaluators || []
    const baseEvaluators = Array.isArray(evaluators) ? evaluators : Object.values(evaluators)
    const allEvaluators = useMemo(() => {
        const bySlug = new Map<string, any>()
        ;[...comparisonRunsEvaluators, ...baseEvaluators].forEach((ev: any) => {
            if (ev?.slug && !bySlug.has(ev.slug)) bySlug.set(ev.slug, ev)
        })
        return Array.from(bySlug.values())
    }, [comparisonRunsEvaluators, baseEvaluators])

    const rawColumns = useMemo(
        () =>
            buildScenarioTableData({
                runIndex,
                metricsFromEvaluators,
                runId: baseRunId,
                evaluators: allEvaluators,
            }),
        [runIndex, metricsFromEvaluators, allEvaluators, expendedRows],
    )

    const columnsWithRunSpecificSteps = useMemo(() => {
        if (!rawColumns) return [] as TableColumn[]

        const allRunIndexes: Record<string, RunIndex | null | undefined> = {
            [baseRunId]: runIndex,
            ...(comparisonRunIndexes || {}),
        }

        const cache = new Map<string, any[]>()

        const getColumnsForRun = (runId: string) => {
            if (cache.has(runId)) return cache.get(runId)!
            const idx = allRunIndexes[runId]
            const cols = idx ? Object.values(idx.columnsByStep || {}).flat() : []
            cache.set(runId, cols)
            return cols
        }

        const matchStepKey = (runId: string, column: any): string | undefined => {
            if (runId === baseRunId && column.stepKey) return column.stepKey
            const candidates = getColumnsForRun(runId)
            const match = candidates.find((candidate) => {
                if (candidate.kind !== column.kind) return false
                if (column.path && candidate.path) {
                    return candidate.path === column.path
                }
                if (column.name && candidate.name) {
                    return candidate.name === column.name
                }
                return false
            })
            return match?.stepKey
        }

        const attach = (columns: any[]): any[] =>
            columns.map((column) => {
                const children = column.children ? attach(column.children) : undefined
                const shouldAttachStepKey =
                    column.kind === "input" ||
                    column.kind === "invocation" ||
                    column.kind === "annotation"

                if (!shouldAttachStepKey) {
                    return children ? {...column, children} : column
                }

                const stepKeyByRunId = Object.keys(allRunIndexes).reduce<
                    Record<string, string | undefined>
                >((acc, runId) => {
                    const mapped = matchStepKey(runId, column)
                    if (mapped) acc[runId] = mapped
                    return acc
                }, {})

                if (column.stepKey && !stepKeyByRunId[baseRunId]) {
                    stepKeyByRunId[baseRunId] = column.stepKey
                }

                if (!Object.keys(stepKeyByRunId).length) {
                    return children ? {...column, children} : column
                }

                const enriched = {
                    ...column,
                    stepKeyByRunId,
                }
                if (children) enriched.children = children
                return enriched
            })

        return attach(rawColumns as any[]) as TableColumn[]
    }, [rawColumns, baseRunId, runIndex, comparisonRunIndexes])

    // Build Ant Design columns using the same function as regular table
    const baseAntColumns = useMemo(
        () =>
            buildAntdColumns(columnsWithRunSpecificSteps as TableColumn[], baseRunId, expendedRows),
        [columnsWithRunSpecificSteps, baseRunId, expendedRows],
    )

    const hiddenColumns = useAtomValue(editColumnsFamily(baseRunId), {store})

    const antColumns = useMemo(
        () => filterColumns(baseAntColumns, hiddenColumns),
        [baseAntColumns, hiddenColumns],
    )

    // For backward compatibility, also provide basic columns
    const columns = baseAntColumns

    // No longer need expandedRowRender - using children approach instead
    const expandedRowRender = undefined

    const loading = false

    // Build rows with actual scenario data - use the SAME approach as regular table
    const scenarioIds = useAtomValue(displayedScenarioIdsFamily(baseRunId), {store}) || []

    const rows = useMemo(() => {
        const builtRows = scenarioIds.map((scenarioId, idx) => {
            // Get matched comparison scenarios for this base scenario
            const comparedScenarios = matchedScenarios[scenarioId] || []

            // Create base row structure
            const baseRow = {
                key: scenarioId,
                scenarioIndex: idx + 1,
                runId: baseRunId, // This row represents the base run
                compareIndex: 1,
                // Add children for comparison scenarios
                children: comparedScenarios.map((compScenario, compIdx) => ({
                    key: `${scenarioId}-comp-${compScenario.runId}-${compIdx}`,
                    scenarioIndex: idx + 1, // Same scenario index as parent
                    runId: compScenario.runId, // Use comparison run ID
                    scenarioId: compScenario.scenarioId, // Use comparison scenario ID
                    isComparison: true, // Flag to identify comparison rows
                    isLastRow: compIdx === comparedScenarios.length - 1,
                    compareIndex: compScenario.compareIndex,
                })),
            }

            return baseRow
        })

        return builtRows
    }, [scenarioIds, matchedScenarios, baseRunId])

    return {
        antColumns,
        columns,
        rawColumns: baseAntColumns,
        rows,
        expandedRowRender,
        loading,
        totalColumnWidth: 0, // TODO: Calculate if needed
    }
}

export default useExpandableComparisonDataSource
