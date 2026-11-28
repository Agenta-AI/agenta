import {useCallback} from "react"

import {
    evaluationRunQueryAtomFamily,
    evaluationRunQueryKey,
    runLevelMetricsQueryKey,
    runScenarioMetricsQueryKey,
    scenarioStepsQueryKey,
} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"
import {atom, useAtom, useAtomValue} from "jotai"

import {useProjectPermission} from "@/features/context/useProjectPermission"
import {runScenariosQueryKey} from "@/features/evaluation-run/scenarios/useRunScenarios"

const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed", "done"])
const IN_FLIGHT_STATUSES = new Set(["running", "in_progress"])
const FAILED_STATUSES = new Set(["failure", "failed", "error", "errors"])

/** True when a stored app call result failed. */
export const isFailedInvocationStatus = (status: string | null | undefined) =>
    FAILED_STATUSES.has(status?.toLowerCase() ?? "")

/** Runs started from this screen, by `runId:scenarioId`; it outlives a move to another scenario. */
const invocationRunsAtom = atom<Record<string, "running" | "failed">>({})

export interface ScenarioInvocationState {
    /** The scenario waits for a person to run the app before it can be annotated. */
    pending: boolean
    running: boolean
    /** The last run of the app for this scenario failed. */
    failed: boolean
    /** The reader may run the app (`edit_evaluation_results`) and the run is not closed. */
    canRun: boolean
    run: () => void
}

/** A scenario and the status of its human invocation step result (none before the first run). */
export interface InvocationScenario {
    id: string
    invocationStatus: string | null | undefined
}

/**
 * The human invocation step of one scenario: a human run calls its app only when a person asks,
 * and the output is what the annotation links to. Nothing runs on its own: opening a scenario
 * spends no model credits. The runner is loaded when Run is clicked.
 */
export function useScenarioInvocation(
    runId: string,
    scenario: InvocationScenario | null,
): ScenarioInvocationState {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const canRun = useProjectPermission(projectId, "edit_evaluation_results")
    const run = useAtomValue(evaluationRunQueryAtomFamily(runId)).data
    const steps = run?.data?.steps
    const stepKey =
        steps?.find((step) => step.type === "invocation" && step.origin === "human")?.key ?? null
    const queryClient = useQueryClient()
    const [runs, setRuns] = useAtom(invocationRunsAtom)

    const scenarioId = scenario?.id ?? ""
    const key = `${runId}:${scenarioId}`
    const status = scenario?.invocationStatus?.toLowerCase() ?? ""
    const pending =
        Boolean(stepKey && scenario) &&
        !SUCCESS_STATUSES.has(status) &&
        !IN_FLIGHT_STATUSES.has(status)
    const running = runs[key] === "running"

    const start = useCallback(() => {
        if (!stepKey || !scenarioId) return
        const settle = (next: "failed" | null) =>
            setRuns(({[key]: _done, ...rest}) => (next ? {...rest, [key]: next} : rest))
        setRuns((current) => ({...current, [key]: "running"}))
        void (async () => {
            try {
                const {runScenarioInvocation} = await import("./runScenarioInvocation")
                const result = await runScenarioInvocation({projectId, runId, scenarioId, stepKey})
                // The rows and the scenario's step results are read again before the Run button
                // goes, so the form replaces it in the run screens and in the queue.
                await Promise.all(
                    [
                        scenarioStepsQueryKey(runId, scenarioId),
                        runScenariosQueryKey(projectId, runId),
                        runLevelMetricsQueryKey(projectId, runId),
                        runScenarioMetricsQueryKey(projectId, runId),
                        evaluationRunQueryKey(runId),
                    ].map((queryKey) => queryClient.invalidateQueries({queryKey})),
                )
                if (result.ok) {
                    message.success("Invocation completed")
                    settle(null)
                    return
                }
                console.error("[runScenarioInvocation]", result.reason, result.detail)
            } catch (error) {
                console.error("[runScenarioInvocation]", error)
            }
            message.error("Couldn't run this scenario")
            settle("failed")
        })()
    }, [stepKey, scenarioId, key, projectId, runId, queryClient, setRuns])

    return {
        pending,
        running,
        failed: runs[key] === "failed" || isFailedInvocationStatus(status),
        // A closed run refuses new results: the app would be called for nothing.
        canRun: canRun && !run?.flags?.is_closed,
        run: start,
    }
}
