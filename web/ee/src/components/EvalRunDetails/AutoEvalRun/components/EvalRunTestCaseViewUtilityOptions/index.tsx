import EditColumns from "@/oss/components/Filters/EditColumns"
import {convertToStringOrJson} from "@/oss/lib/helpers/utils"
import {
    evalAtomStore,
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

            // Add inputs
            Object.entries(inputs).forEach(([k, v]) => {
                record[`input.${k}`] = convertToStringOrJson(v)
            })

            // Add ground truths
            Object.entries(groundTruth).forEach(([k, v]) => {
                record[k] = convertToStringOrJson(v)
            })

            // Add evaluator metrics
            const step = scenario.steps.find((step) => step.scenarioId === sid)
            const annotation = step?.annotation?.data.outputs
            const evaluatorName = step?.annotation?.references.evaluator?.slug
            Object.entries(annotation).forEach(([k, v]) => {
                const metrics = annotation[k]
                if (metrics) {
                    Object.entries(metrics).forEach(([key, stats]) => {
                        record[`${evaluatorName}.${key}`] = convertToStringOrJson(stats)
                    })
                }
            })

            // Extract model output from the first invocation step that contains a trace
            const invWithTrace = scenario.invocationSteps?.find((inv: any) => inv.trace)
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

            record.status = inputStatus ?? "unknown"
            return record
        })

        return data
    }, [evalAtomStore])

    const onClickSaveData = useCallback(async () => {
        const data = await csvDataFormat()
        setRows(data)
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
