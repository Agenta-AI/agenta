import {memo, useCallback, useState} from "react"

import RunButton from "@agenta/oss/src/components/Playground/assets/RunButton"
import {useAtomValue} from "jotai"
import {loadable} from "jotai/utils"

// agenta hooks & utils
import {useRunId} from "@/oss/contexts/RunIdContext"
import {convertToStringOrJson} from "@/oss/lib/helpers/utils"
import {useEvalScenarioQueue} from "@/oss/lib/hooks/useEvalScenarioQueue"
import {
    scenarioStepFamily,
    scenariosFamily,
    evalAtomStore,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {scenarioMetricsMapFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"

import SaveDataButton from "../../components/SaveDataModal/assets/SaveDataButton"
import {hasRunnableScenarioFamily} from "../assets/runnableSelectors"

import InstructionButton from "./Modals/InstructionModal/assets/InstructionButton"

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
    const runId = useRunId()
    const store = evalAtomStore()

    const {enqueueScenario} = useEvalScenarioQueue({concurrency: 5, runId})

    // Lightweight subscription: only track the count of runnable scenarios - use global store
    const hasRunnable = useAtomValue(hasRunnableScenarioFamily(runId), {store})
    const isRunAllDisabled = !hasRunnable

    const handleRunAll = useCallback(async () => {
        if (!runId) return

        try {
            const store = evalAtomStore()

            // Get all scenarios for this run (same as single run approach)
            const scenarios = store.get(scenariosFamily(runId))
            console.log(`[EvalRunBatchActions] Found ${scenarios.length} total scenarios`)

            if (scenarios.length === 0) {
                console.warn("[EvalRunBatchActions] No scenarios found")
                return
            }

            let enqueuedCount = 0

            // For each scenario, get its step data using the same approach as RunEvalScenarioButton
            for (const scenario of scenarios) {
                const scenarioId = scenario.id

                try {
                    // Use the same loadable approach as RunEvalScenarioButton
                    const stepLoadableAtom = loadable(scenarioStepFamily({scenarioId, runId}))
                    const stepLoadable = store.get(stepLoadableAtom)

                    if (stepLoadable.state !== "hasData" || !stepLoadable.data) {
                        console.log(
                            `[EvalRunBatchActions] Scenario ${scenarioId} - step data not ready (state: ${stepLoadable.state})`,
                        )
                        continue
                    }

                    const invocationSteps = stepLoadable.data.invocationSteps || []
                    console.log(
                        `[EvalRunBatchActions] Scenario ${scenarioId} has ${invocationSteps.length} invocation steps`,
                    )

                    // Find the first step with invocation parameters (same logic as RunEvalScenarioButton)
                    const targetStep = invocationSteps.find((s: any) => s.invocationParameters)

                    if (targetStep && targetStep.invocationParameters) {
                        // Check if step is not already running or successful
                        const isRunning = invocationSteps.some((s: any) => s.status === "running")
                        const isSuccess = (targetStep as any).status === "success"

                        if (!isRunning && !isSuccess) {
                            console.log(
                                `[EvalRunBatchActions] Enqueuing scenario ${scenarioId}, step ${targetStep.stepKey}`,
                            )
                            enqueueScenario(scenarioId, targetStep.stepKey)
                            enqueuedCount++
                        } else {
                            console.log(
                                `[EvalRunBatchActions] Skipping scenario ${scenarioId} - already running or successful`,
                            )
                        }
                    } else {
                        console.log(
                            `[EvalRunBatchActions] Skipping scenario ${scenarioId} - no invocation parameters`,
                        )
                    }
                } catch (error) {
                    console.error(
                        `[EvalRunBatchActions] Error processing scenario ${scenarioId}:`,
                        error,
                    )
                }
            }

            console.log(
                `[EvalRunBatchActions] Run all completed, enqueued ${enqueuedCount} scenarios`,
            )

            // Note: Metrics will be automatically fetched by store-level subscription
            if (enqueuedCount > 0) {
                console.log(
                    `[EvalRunBatchActions] Enqueued ${enqueuedCount} scenarios for runId: ${runId}`,
                )
            }
        } catch (error) {
            console.error("[EvalRunBatchActions] Error in handleRunAll:", error)
        }
    }, [runId, enqueueScenario])

    const csvDataFormat = useCallback(async () => {
        if (!runId) return []

        // 1. Gather the scenario IDs present in the current evaluation (sync)
        const store = evalAtomStore()
        const scenarios = store.get(scenariosFamily(runId))
        const ids = scenarios.map((s: any) => s.id)

        // 2. Resolve (possibly async) scenario step data for each id
        const [scenarioMetricsMap, ...allScenarios] = await Promise.all([
            store.get(scenarioMetricsMapFamily(runId)),
            ...ids.map((id) => store.get(scenarioStepFamily({runId, scenarioId: id}))),
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
                const evaluatorSlug = (annStep.stepKey as string)?.split(".")[1]
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
    }, [runId])

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
