import EditColumns from "@/oss/components/Filters/EditColumns"
import {convertToStringOrJson} from "@/oss/lib/helpers/utils"
import {
    evalAtomStore,
    evaluationEvaluatorsAtom,
    evaluationRunStateAtom,
    scenariosAtom,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {scenarioMetricsMapAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"
import {ColumnsType} from "antd/es/table"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {Dispatch, memo, SetStateAction, useCallback, useState} from "react"
import EvalRunScenarioNavigator from "../../../components/EvalRunScenarioNavigator"
import SaveDataButton from "../../../components/SaveDataModal/assets/SaveDataButton"
import {message} from "antd"
import {metricsFromEvaluatorsAtom} from "../../../components/VirtualizedScenarioTable/hooks/useTableDataSource"

const EMPTY_ROWS: any[] = []

const EvalRunTestCaseViewUtilityOptions = ({
    columns,
    setEditColumns,
}: {
    columns: ColumnsType
    setEditColumns: Dispatch<SetStateAction<string[]>>
}) => {
    const router = useRouter()
    // states for select dropdown
    const [rows, setRows] = useState<any[]>(EMPTY_ROWS)
    const evaluation = useAtomValue(evaluationRunStateAtom)

    const selectedScenarioId = router.query.scrollTo as string

    const csvDataFormat = useCallback(async () => {
        // 1. Gather the scenario IDs present in the current evaluation (sync)
        const store = evalAtomStore()
        const ids = store.get(scenariosAtom).map((s) => s.id)
        const evaluators = store.get(evaluationEvaluatorsAtom)
        const evaluatorSlugs = evaluators.map((e) => e.slug)

        // 2. Resolve (possibly async) scenario step data for each id
        const [scenarioMetricsMap, ...allScenarios] = await Promise.all([
            store.get(scenarioMetricsMapAtom),
            ...ids.map((id) => store.get(scenarioStepFamily(id))),
        ])

        // 3. Build the CSV-friendly records
        const data = allScenarios.map((scenario) => {
            if (!scenario) return {}
            const sid = scenario.steps?.[0]?.scenarioId

            const primaryInput = scenario.inputSteps?.find((s: any) => s.inputs) || {}
            const {inputs = {}, groundTruth = {}, status: inputStatus} = primaryInput as any

            const record: Record<string, any> = {}

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
                const invWithTrace = scenario.invocationSteps?.find((inv: any) => inv.error)
                record.output = convertToStringOrJson(
                    invWithTrace.error.stacktrace || invWithTrace.error,
                )
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

            // 4. Add annotation
            const annSteps = scenario.steps.filter((step) => evaluatorSlugs.includes(step.key))
            const steps = annSteps.length
                ? annSteps
                : scenario.invocationSteps?.filter((inv: any) => inv.error)
            const annotation = scenarioMetricsMap?.[sid]

            if (steps?.some((step) => step.error) || invWithTrace?.error) {
                const evalMetrics = store.get(metricsFromEvaluatorsAtom)
                steps.forEach((step) => {
                    if (!step.error) return null

                    const errorMessage = step.error.stacktrace || step?.error?.message || step.error
                    Object.entries(evalMetrics || {}).forEach(([k, v]) => {
                        // if (k !== step.key) return null
                        if (Array.isArray(v)) {
                            v.forEach((metric) => {
                                const evaluator = evaluators?.find(
                                    (e) => e?.slug === metric?.evaluatorSlug,
                                )
                                const {evaluatorSlug, ...rest} = metric

                                Object.keys(rest || {}).forEach((metricKey) => {
                                    if (evaluator) {
                                        record[`${evaluator?.name}.${metricKey}`] =
                                            convertToStringOrJson(errorMessage)
                                    } else {
                                        record[`${metric?.evaluatorSlug}.${metricKey}`] =
                                            convertToStringOrJson(errorMessage)
                                    }
                                })
                            })
                        }
                    })
                })
            }

            if (annotation) {
                Object.entries(annotation || {}).forEach(([k, v]) => {
                    if (!k.includes(".")) return
                    const [evalSlug, metricName] = k.split(".")
                    if (["error", "errors"].includes(metricName)) return
                    const evaluator = evaluators?.find((e) => e?.slug === evalSlug)

                    if (v.mean) {
                        record[`${evaluator?.name}.${metricName}`] = v?.mean
                    } else if (v.unique) {
                        const mostFrequent = v.frequency.reduce((max, current) =>
                            current.count > max.count ? current : max,
                        ).value
                        record[`${evaluator?.name}.${metricName}`] = String(mostFrequent)
                    } else if (v && typeof v !== "object") {
                        record[`${evaluator?.name}.${metricName}`] =
                            typeof v === "number"
                                ? String(v).includes(".")
                                    ? v.toFixed(3)
                                    : v
                                : convertToStringOrJson(v)
                    }
                })
            }
            return record
        })

        return data
    }, [evalAtomStore])

    const onClickSaveData = useCallback(async () => {
        try {
            const data = await csvDataFormat()
            setRows(data)
        } catch (error) {
            console.log("error", error.message)
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
                    columns={columns as ColumnsType}
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
