import {memo, useCallback, useState} from "react"

import {useAtomValue} from "jotai"

// agenta hooks & utils
import {convertToStringOrJson} from "@/oss/lib/helpers/utils"
import {useEvalScenarioQueue} from "@/oss/lib/hooks/useEvalScenarioQueue"
import {
    evalAtomStore,
    scenariosAtom,
    scenarioStepsAtom,
    scenarioStepFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {scenarioMetricsMapAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"

import RunButton from "../../Playground/assets/RunButton"
import {runnableScenarioIdsAtom} from "../assets/runnableSelectors"
import {hasRunnableScenarioAtom} from "../assets/runnableSelectors"

import InstructionButton from "./Modals/InstructionModal/assets/InstructionButton"
import SaveDataButton from "./Modals/SaveDataModal/assets/SaveDataButton"

const EMPTY_ROWS: any[] = []

/**
 * This component renders a bar of buttons above the scenario table.
 * It includes a button to run all scenarios, a button to export results,
 * a button to save the test set, a button to refresh the page, and a button
 * to open the instruction modal.
 *
 * @returns A JSX element containing a bar of buttons.
 */
// derived atom: keeps only the length (count) of runnable scenarios to minimise re-renders

const EvalRunBatchActions = ({name}: {name: string}) => {
    const [rows, setRows] = useState<any[]>(EMPTY_ROWS)

    const {enqueueScenario} = useEvalScenarioQueue({concurrency: 5})

    // Lightweight subscription: only track the count of runnable scenarios
    const hasRunnable = useAtomValue(hasRunnableScenarioAtom)
    const isRunAllDisabled = !hasRunnable

    const handleRunAll = useCallback(() => {
        const ids = evalAtomStore().get(runnableScenarioIdsAtom)
        const stepsMap = evalAtomStore().get(scenarioStepsAtom)
        ids.forEach((id) => {
            const loadable = stepsMap[id]
            const invocationSteps = loadable?.data?.invocationSteps ?? []
            invocationSteps.forEach((st: any) => enqueueScenario(id, st.key))
        })
    }, [enqueueScenario])

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
                record[k] = convertToStringOrJson(v)
            })

            // Add ground truths
            Object.entries(groundTruth).forEach(([k, v]) => {
                record[k] = convertToStringOrJson(v)
            })

            // Add annotation metrics/notes per evaluator slug
            scenario.annotationSteps?.forEach((annStep: any) => {
                const evaluatorSlug = (annStep.key as string)?.split(".")[1]
                if (!evaluatorSlug) return

                // 1. summarize metrics from scenarioMetricsMap for this scenario by slug prefix
                const summarized: Record<string, any> = {}
                // const sid =
                //     scenario.scenarioId || (scenario as any).scenario_id || (scenario as any).id
                const scenarioMetrics = scenarioMetricsMap?.[String(sid)] || {}
                Object.entries(scenarioMetrics).forEach(([fullKey, stats]) => {
                    if (fullKey.startsWith(`${evaluatorSlug}.`)) {
                        const metricKey = fullKey.slice(evaluatorSlug.length + 1)
                        summarized[metricKey] = stats
                    }
                })

                if (Object.keys(summarized).length) {
                    record[evaluatorSlug] = convertToStringOrJson({...summarized})
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
        <div className="flex flex-wrap gap-1">
            <RunButton
                isRunAll
                type="primary"
                size="middle"
                onClick={handleRunAll}
                disabled={isRunAllDisabled}
            />

            <SaveDataButton
                exportDataset
                label="Export results"
                onClick={onClickSaveData}
                rows={rows}
                name={name}
            />

            <SaveDataButton label="Save test set" onClick={onClickSaveData} rows={rows} />

            <InstructionButton />
        </div>
    )
}

export default memo(EvalRunBatchActions)
