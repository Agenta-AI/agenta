import {Dispatch, memo, SetStateAction, useCallback, useMemo, useState} from "react"

import {message} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import EditColumns from "@/oss/components/Filters/EditColumns"
import {useRunId} from "@/oss/contexts/RunIdContext"
import {convertToStringOrJson} from "@/oss/lib/helpers/utils"
import {
    evalAtomStore,
    evaluationEvaluatorsFamily,
    evaluationRunStateFamily,
    scenarioIdsFamily,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {scenarioMetricsMapFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"

import EvalRunScenarioNavigator from "../../../components/EvalRunScenarioNavigator"
import SaveDataButton from "../../../components/SaveDataModal/assets/SaveDataButton"
import useExpandableComparisonDataSource from "../../../components/VirtualizedScenarioTable/hooks/useExpandableComparisonDataSource"
import {metricsFromEvaluatorsFamily} from "../../../components/VirtualizedScenarioTable/hooks/useTableDataSource"
import {urlStateAtom} from "../../../state/urlState"

const EMPTY_ROWS: any[] = []

interface ScenarioCsvRow {
    scenarioId?: string
    record: Record<string, any>
}

const extractPrimitiveMetricValue = (input: any): any => {
    if (input === null || input === undefined) return input
    if (typeof input !== "object") return input
    if (Array.isArray(input)) {
        for (const item of input) {
            const value = extractPrimitiveMetricValue(item)
            if (value !== undefined) return value
        }
        return undefined
    }
    if (typeof (input as any).mean !== "undefined") return (input as any).mean
    if (typeof (input as any).value !== "undefined") return (input as any).value
    if (Array.isArray((input as any).frequency) && (input as any).frequency.length) {
        const sorted = [...(input as any).frequency].sort(
            (a, b) => (b?.count ?? 0) - (a?.count ?? 0),
        )
        const candidate = sorted.find((entry) => entry?.value !== undefined)
        if (candidate) return candidate.value
    }
    if (Array.isArray((input as any).rank) && (input as any).rank.length) {
        const candidate = (input as any).rank.find((entry: any) => entry?.value !== undefined)
        if (candidate) return candidate.value
    }
    if (Array.isArray((input as any).unique) && (input as any).unique.length) {
        return (input as any).unique.find((item: any) => item !== undefined)
    }
    for (const value of Object.values(input)) {
        const extracted = extractPrimitiveMetricValue(value)
        if (extracted !== undefined) return extracted
    }
    return undefined
}

const parseAnnotationMetricKey = (
    key: string,
): null | {slug: string; metric: string; source: "direct" | "analytics"} => {
    if (!key.includes(".")) return null
    if (key.startsWith("attributes.ag.")) return null
    const analyticsOutputMatch = key.match(/^([^\.]+)\.attributes\.ag\.data\.outputs\.(.+)$/)
    if (analyticsOutputMatch) {
        return {slug: analyticsOutputMatch[1], metric: analyticsOutputMatch[2], source: "analytics"}
    }
    const analyticsMetricMatch = key.match(/^([^\.]+)\.attributes\.ag\.metrics\.(.+)$/)
    if (analyticsMetricMatch) {
        return {
            slug: analyticsMetricMatch[1],
            metric: analyticsMetricMatch[2],
            source: "analytics",
        }
    }
    const [slug, ...rest] = key.split(".")
    const metric = rest.join(".")
    if (!slug || !metric) return null
    return {slug, metric, source: "direct"}
}

const EvalRunTestCaseViewUtilityOptions = ({
    columns,
    setEditColumns,
}: {
    columns: ColumnsType
    setEditColumns: Dispatch<SetStateAction<string[]>>
}) => {
    const runId = useRunId()
    const router = useRouter()
    // states for select dropdown
    const [rows, setRows] = useState<any[]>(EMPTY_ROWS)
    const evaluation = useAtomValue(evaluationRunStateFamily(runId))
    const urlState = useAtomValue(urlStateAtom)
    // Determine runs to include: base + comparisons (unique, exclude base duplicates)
    const compareRunIds = useMemo(
        () => (urlState?.compare || []).filter(Boolean) as string[],
        [urlState?.compare],
    )
    const hasComparisons = compareRunIds.length > 0
    const allRunIds = Array.from(new Set([runId, ...compareRunIds.filter((id) => id !== runId)]))
    const selectedScenarioId = router.query.scrollTo as string

    const {rawColumns: comparisonRawColumns} = useExpandableComparisonDataSource({
        baseRunId: runId,
        comparisonRunIds: compareRunIds,
    })

    const csvDataFormat = useCallback(async () => {
        const store = evalAtomStore()

        // Helper: build rows for a single run
        const buildRowsForRun = async (rId: string): Promise<ScenarioCsvRow[]> => {
            // 1) Scenario IDs and evaluator info for this run
            const ids = store.get(scenarioIdsFamily(rId))
            const evaluatorsRaw = store.get(evaluationEvaluatorsFamily(rId)) || []
            const evaluatorList: any[] = Array.isArray(evaluatorsRaw)
                ? (evaluatorsRaw as any[])
                : Object.values(evaluatorsRaw as any)
            const evaluatorSlugs = evaluatorList.map((e: any) => e.slug)
            const baseEvaluatorMap = new Map<string, any>()
            evaluatorList.forEach((evaluator: any) => {
                if (evaluator?.slug) baseEvaluatorMap.set(evaluator.slug, evaluator)
            })

            // 2) Resolve steps and metrics for this run
            const [scenarioMetricsMap, ...allScenarios] = await Promise.all([
                store.get(scenarioMetricsMapFamily(rId)),
                ...ids.map((id) => store.get(scenarioStepFamily({runId: rId, scenarioId: id}))),
            ])

            // Evaluation name for this run (for column 'name' when comparing)
            const runState = store.get(evaluationRunStateFamily(rId))
            const evalName = runState?.enrichedRun?.name

            // 3) Build CSV-friendly rows for this run
            const rowsForRun: ScenarioCsvRow[] = []

            allScenarios.forEach((scenario) => {
                if (!scenario) return
                const sid = scenario.scenarioId || scenario.id || scenario.steps?.[0]?.scenarioId
                const scenarioId = sid ? String(sid) : undefined

                const scenarioEvaluatorMap = new Map(baseEvaluatorMap)
                const registerEvaluator = (candidate?: any) => {
                    if (!candidate?.slug) return
                    const existing = scenarioEvaluatorMap.get(candidate.slug)
                    if (existing && existing.name) return
                    scenarioEvaluatorMap.set(candidate.slug, {...existing, ...candidate})
                }
                ;(scenario.steps || []).forEach((step: any) => {
                    registerEvaluator(step?.evaluator)
                    registerEvaluator(step?.annotation?.references?.evaluator)
                })
                ;(scenario.annSteps || []).forEach((step: any) => {
                    registerEvaluator(step?.evaluator)
                    registerEvaluator(step?.annotation?.references?.evaluator)
                })
                const resolveEvaluatorLabel = (slug?: string) => {
                    if (!slug) return undefined
                    const evaluator = scenarioEvaluatorMap.get(slug)
                    return evaluator?.name || evaluator?.displayName || evaluator?.slug || slug
                }

                const primaryInput = scenario.inputSteps?.find((s: any) => s.inputs) || {}
                const {inputs = {}, groundTruth = {}, status: inputStatus} = primaryInput as any

                const record: Record<string, any> = {}

                // When in comparison mode, include evaluation name
                if (hasComparisons && evalName) {
                    record.name = evalName
                }

                // 1. Add input
                if (!Object.keys(groundTruth).length) {
                    Object.entries(primaryInput.testcase?.data || {}).forEach(([k, v]) => {
                        if (k === "testcase_dedup_id") return
                        record[`input.${k}`] = convertToStringOrJson(v)
                    })
                } else {
                    Object.entries(inputs || {}).forEach(([k, v]) => {
                        record[`input.${k}`] = convertToStringOrJson(v)
                    })
                }

                // 2. Add output
                // Extract model output from the first invocation step that contains a trace
                const invWithTrace = scenario.invocationSteps?.find((inv: any) => inv.trace)

                if (!invWithTrace) {
                    const invWithErr = scenario.invocationSteps?.find((inv: any) => inv.error)
                    if (invWithErr) {
                        record.output = convertToStringOrJson(
                            invWithErr.error?.stacktrace || invWithErr.error,
                        )
                    }
                }

                if (invWithTrace) {
                    const traceObj = invWithTrace?.trace
                    let traceOutput: any
                    if (Array.isArray(traceObj?.nodes)) {
                        traceOutput = traceObj.nodes[0]?.data?.outputs
                    } else if (Array.isArray(traceObj?.trees)) {
                        traceOutput = traceObj.trees[0]?.nodes?.[0]?.data?.outputs
                    }

                    if (traceOutput) {
                        record.output = convertToStringOrJson(traceOutput)
                    }
                }

                // 3. Add status
                if (!invWithTrace) {
                    const _invWithTrace = scenario.invocationSteps?.find((inv: any) => inv.error)
                    record.status = _invWithTrace?.status ?? "unknown"
                } else {
                    record.status = invWithTrace?.status ?? "unknown"
                }

                // 4. Add annotation and metrics/errors
                const annSteps = scenario.steps.filter((step) =>
                    evaluatorSlugs.includes(step.stepKey),
                )
                const steps = annSteps.length
                    ? annSteps
                    : scenario.invocationSteps?.filter((inv: any) => inv.error)
                const annotation = scenarioMetricsMap?.[sid]

                // Prefill metric columns so compare-eval metrics are visible even if values missing yet
                const evalMetricsDefs = store.get(metricsFromEvaluatorsFamily(rId)) as any
                if (evalMetricsDefs && typeof evalMetricsDefs === "object") {
                    Object.entries(evalMetricsDefs).forEach(([slug, defs]: [string, any[]]) => {
                        const label = resolveEvaluatorLabel(slug)
                        if (!label) return
                        if (!Array.isArray(defs)) return
                        defs.forEach((metricDef) => {
                            Object.keys(metricDef || {})
                                .filter((k) => k !== "evaluatorSlug")
                                .forEach((metricName) => {
                                    const key = `${label}.${metricName}`
                                    if (!(key in record)) record[key] = ""
                                })
                        })
                    })
                }

                if (steps?.some((step) => step.error) || invWithTrace?.error) {
                    const evalMetrics = store.get(metricsFromEvaluatorsFamily(rId))
                    steps.forEach((step) => {
                        if (!step.error) return null

                        const errorMessage =
                            step.error.stacktrace || step?.error?.message || step.error
                        Object.entries(evalMetrics || {}).forEach(([k, v]) => {
                            if (Array.isArray(v)) {
                                v.forEach((metric) => {
                                    const {evaluatorSlug, ...rest} = metric
                                    const label =
                                        resolveEvaluatorLabel(evaluatorSlug) ||
                                        evaluatorSlug ||
                                        "unknown"

                                    Object.keys(rest || {}).forEach((metricKey) => {
                                        record[`${label}.${metricKey}`] =
                                            convertToStringOrJson(errorMessage)
                                    })
                                })
                            }
                        })
                    })
                }

                if (annotation) {
                    Object.entries(annotation || {}).forEach(([k, v]) => {
                        const parsed = parseAnnotationMetricKey(k)
                        if (!parsed) return
                        if (["error", "errors"].includes(parsed.metric)) return
                        const label = resolveEvaluatorLabel(parsed.slug)
                        if (!label) return

                        const primitive = extractPrimitiveMetricValue(v)
                        if (primitive === undefined) return

                        const recordKey = `${label}.${parsed.metric}`
                        const existingValue = record[recordKey]
                        if (
                            parsed.source === "direct" &&
                            existingValue !== undefined &&
                            existingValue !== null &&
                            existingValue !== ""
                        ) {
                            return
                        }

                        record[recordKey] =
                            typeof primitive === "number"
                                ? Number.isFinite(primitive) && !Number.isInteger(primitive)
                                    ? primitive.toFixed(3)
                                    : primitive
                                : convertToStringOrJson(primitive)
                    })
                }
                rowsForRun.push({record, scenarioId})
            })

            return rowsForRun
        }

        // Build data across all runs
        const rowsByRun = new Map<string, ScenarioCsvRow[]>()
        const lookupByRun = new Map<string, Map<string, ScenarioCsvRow>>()

        for (const rId of allRunIds) {
            const rows = await buildRowsForRun(rId)
            rowsByRun.set(rId, rows)

            const scenarioLookup = new Map<string, ScenarioCsvRow>()
            rows.forEach((row) => {
                if (row && row.scenarioId) {
                    scenarioLookup.set(row.scenarioId, row)
                }
            })
            lookupByRun.set(rId, scenarioLookup)
        }

        if (!hasComparisons) {
            const baseRows = rowsByRun.get(runId) || []
            return baseRows.map(({record}) => record)
        }

        const orderedResults: Record<string, any>[] = []
        const baseRows = rowsByRun.get(runId) || []
        const uniqueCompareRunIds = Array.from(
            new Set(compareRunIds.filter((id) => id && id !== runId)),
        )

        baseRows.forEach((baseRow, index) => {
            if (!baseRow) return
            orderedResults.push(baseRow.record)

            uniqueCompareRunIds.forEach((compareId) => {
                const compareRows = rowsByRun.get(compareId) || []
                if (!compareRows.length) return

                const scenarioLookup = lookupByRun.get(compareId)
                const matchedRow =
                    (baseRow.scenarioId && scenarioLookup?.get(baseRow.scenarioId)) ||
                    compareRows[index]

                if (matchedRow) {
                    orderedResults.push(matchedRow.record)
                }
            })
        })

        return orderedResults
    }, [runId, evalAtomStore, allRunIds, compareRunIds, hasComparisons])

    const onClickSaveData = useCallback(async () => {
        try {
            const data = await csvDataFormat()
            setRows(data)
        } catch (error) {
            message.error("Failed to export results")
        }
    }, [csvDataFormat])

    return (
        <div className="flex items-center justify-between gap-4 py-2 px-6">
            <div className="flex items-center gap-2">
                <span className="text-nowrap">Go to test case:</span>
                <EvalRunScenarioNavigator
                    querySelectorName="scrollTo"
                    activeId={selectedScenarioId}
                    selectProps={{style: {minWidth: 220}, placeholder: "Navigate in a scenario ##"}}
                    showOnlySelect
                />
            </div>
            <div className="flex items-center gap-2">
                <SaveDataButton
                    exportDataset
                    label="Export results"
                    onClick={onClickSaveData}
                    rows={rows}
                    name={evaluation?.enrichedRun?.name}
                    type="text"
                />
                <EditColumns
                    columns={
                        hasComparisons && comparisonRawColumns
                            ? (comparisonRawColumns as ColumnsType)
                            : (columns as ColumnsType)
                    }
                    uniqueKey="auto-eval-run-testcase-column"
                    onChange={(keys) => {
                        setEditColumns(keys)
                    }}
                />
            </div>
        </div>
    )
}

export default memo(EvalRunTestCaseViewUtilityOptions)
