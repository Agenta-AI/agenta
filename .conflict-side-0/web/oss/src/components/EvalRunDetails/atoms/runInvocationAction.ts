/**
 * Atom for handling run invocation actions in evaluation scenarios.
 * This provides a global action that can be triggered from table cells
 * without needing to use hooks in each cell.
 *
 * Uses executeWorkflowRevision from @agenta/playground, which leverages
 * the full playground runner (concurrency limiting, abort, URL/payload
 * resolution via workflowMolecule) rather than a bespoke HTTP call.
 */

import {fetchWorkflowRevisionById} from "@agenta/entities/workflow"
import {workflowMolecule} from "@agenta/entities/workflow"
import {executeWorkflowRevision} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {atom} from "jotai"
import {getDefaultStore} from "jotai"

import {invalidateEvaluationRunsTableAtom} from "@/oss/components/EvaluationRunsTablePOC/atoms/tableStore"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {queryClient} from "@/oss/lib/api/queryClient"
import {clearPreviewRunsCache} from "@/oss/lib/hooks/usePreviewEvaluations/assets/previewRunsRequest"
import {EvaluationStatus} from "@/oss/lib/Types"
import {
    upsertStepResultWithInvocation,
    updateScenarioStatus,
} from "@/oss/services/evaluations/invocations/api"
import {getProjectValues} from "@/oss/state/project"

import {
    evaluationMetricQueryAtomFamily,
    invalidateMetricBatcherCache,
    triggerMetricsRefresh,
} from "./metrics"
import {scenarioStepsQueryFamily, invalidateScenarioStepsBatcherCache} from "./scenarioSteps"
import {evaluationRunIndexAtomFamily} from "./table/run"
import {invalidateTraceBatcherCache} from "./traces"

export interface RunInvocationActionParams {
    scenarioId: string
    runId: string
    stepKey: string
}

/** Track which scenarios are currently running */
export const runningInvocationsAtom = atom<Set<string>>(new Set<string>())

/** Action atom to run an invocation */
export const triggerRunInvocationAtom = atom(
    null,
    async (get, set, params: RunInvocationActionParams) => {
        const {scenarioId, runId, stepKey} = params
        const store = getDefaultStore()

        console.log("[runInvocationAction] Starting invocation", {scenarioId, runId, stepKey})

        // Mark as running
        set(
            runningInvocationsAtom,
            (prev: Set<string>) => new Set([...prev, `${scenarioId}:${stepKey}`]),
        )

        try {
            // Get run index for references
            const runIndex = get(evaluationRunIndexAtomFamily(runId))
            const invocationKeys = Array.from(runIndex?.invocationKeys ?? [])
            const primaryInvocationKey = invocationKeys[0]
            const invocationStepMeta = primaryInvocationKey
                ? runIndex?.steps?.[primaryInvocationKey]
                : undefined
            const refs = invocationStepMeta?.refs ?? {}

            // Extract IDs from references
            const appId =
                refs.application?.id || refs.application?.app_id || refs.application_ref?.id || ""

            const revisionId =
                refs.application_revision?.id ||
                refs.applicationRevision?.id ||
                refs.revision?.id ||
                ""

            if (!appId) {
                console.error("[runInvocationAction] Application ID not found in refs:", refs)
                message.error("Application ID not found")
                return {success: false, error: "Application ID not found"}
            }

            if (!revisionId) {
                console.error("[runInvocationAction] Revision ID not found in refs:", refs)
                message.error("Revision ID not found in run references")
                return {success: false, error: "Revision ID not found"}
            }

            const {projectId} = getProjectValues()
            if (!projectId) {
                message.error("Project ID not available")
                return {success: false, error: "Project ID not available"}
            }

            // Fetch workflow revision and seed it into the default store so that
            // workflowMolecule selectors resolve correctly inside executeWorkflowRevision
            const workflow = await fetchWorkflowRevisionById(revisionId, projectId)
            if (!workflow) {
                message.error("Failed to fetch variant configuration")
                return {success: false, error: "Variant config not available"}
            }

            workflowMolecule.set.seedEntity(revisionId, workflow)

            // Get input data from the scenario's input step / testcase
            const stepsQuery = get(scenarioStepsQueryFamily({scenarioId, runId}))
            const steps = stepsQuery.data?.steps ?? []
            const inputKeys = runIndex?.inputKeys ?? new Set()
            const inputStep = steps.find((step: any) => inputKeys.has(step.stepKey ?? ""))
            const testcaseId = inputStep?.testcaseId ?? inputStep?.testcase_id

            let inputData: Record<string, unknown> = {}
            if (testcaseId) {
                try {
                    const testcaseResponse = await axios.post(
                        `/testcases/query`,
                        {testcase_ids: [testcaseId]},
                        {params: {project_id: projectId}},
                    )
                    const testcases = testcaseResponse.data?.testcases ?? []
                    const testcase = testcases[0]
                    inputData = testcase?.data ?? testcase?.inputs ?? {}
                } catch (err) {
                    console.error("[runInvocationAction] Failed to fetch testcase:", err)
                }
            } else {
                inputData = inputStep?.data ?? inputStep?.inputs ?? {}
            }

            // Run via the playground execution infrastructure
            const result = await executeWorkflowRevision({
                revisionId,
                inputData,
                projectId,
            })

            // Build references for the step result
            const references = {
                application: refs.application?.id ? {id: refs.application.id} : undefined,
                application_variant: refs.application_variant?.id
                    ? {id: refs.application_variant.id}
                    : refs.applicationVariant?.id
                      ? {id: refs.applicationVariant.id}
                      : undefined,
                application_revision: refs.application_revision?.id
                    ? {id: refs.application_revision.id}
                    : refs.applicationRevision?.id
                      ? {id: refs.applicationRevision.id}
                      : undefined,
            }

            if (result.status === "success") {
                // Update step result with trace/span and output from execution
                await upsertStepResultWithInvocation({
                    runId,
                    scenarioId,
                    stepKey,
                    traceId: result.traceId ?? undefined,
                    spanId: result.spanId ?? undefined,
                    status: "success",
                    references,
                    outputs: result.output,
                })

                message.success("Invocation completed")

                // Invalidate all relevant caches to force fresh data
                invalidateScenarioStepsBatcherCache()
                invalidateTraceBatcherCache()
                invalidateMetricBatcherCache()

                await triggerMetricsRefresh({projectId, runId, scenarioId})

                const stepsQueryAtom = scenarioStepsQueryFamily({scenarioId, runId})
                const latestStepsQuery = store.get(stepsQueryAtom)
                await latestStepsQuery.refetch?.()

                const metricQueryAtom = evaluationMetricQueryAtomFamily({scenarioId, runId})
                const metricQuery = store.get(metricQueryAtom)
                await metricQuery.refetch?.()

                clearPreviewRunsCache()
                set(invalidateEvaluationRunsTableAtom)
                await queryClient.refetchQueries({
                    predicate: (query) => {
                        const key = query.queryKey
                        if (!Array.isArray(key)) return false
                        if (key[0] === "evaluation-runs-table") return true
                        if (key[0] === "preview" && key[1] === "run-metric-stats") return true
                        if (key[0] === "eval-table" && key[1] === "scenarios") return true
                        return false
                    },
                })

                return {success: true}
            } else {
                // Record failure in step result
                const errorMessage = result.error?.message ?? "Invocation failed"
                await upsertStepResultWithInvocation({
                    runId,
                    scenarioId,
                    stepKey,
                    traceId: result.traceId ?? undefined,
                    status: "failure",
                    references,
                    error: {message: errorMessage},
                })

                await updateScenarioStatus(scenarioId, EvaluationStatus.FAILURE)

                message.error({content: errorMessage, duration: 8})

                clearPreviewRunsCache()
                set(invalidateEvaluationRunsTableAtom)
                await queryClient.refetchQueries({
                    predicate: (query) => {
                        const key = query.queryKey
                        if (!Array.isArray(key)) return false
                        if (key[0] === "evaluation-runs-table") return true
                        if (key[0] === "preview" && key[1] === "run-metric-stats") return true
                        if (key[0] === "eval-table" && key[1] === "scenarios") return true
                        return false
                    },
                })

                return {success: false, error: errorMessage}
            }
        } catch (error: any) {
            console.error("[runInvocationAction] Error:", error)
            const detail = error?.response?.data?.detail
            let errorMsg = "Unknown error"
            if (detail && typeof detail === "object" && detail.message) {
                errorMsg = detail.message
            } else if (typeof detail === "string") {
                errorMsg = detail
            } else if (error?.message) {
                errorMsg = error.message
            }
            message.error({content: errorMsg, duration: 8})
            return {success: false, error: errorMsg}
        } finally {
            // Mark as not running
            set(runningInvocationsAtom, (prev: Set<string>) => {
                const next = new Set(prev)
                next.delete(`${scenarioId}:${stepKey}`)
                return next
            })
        }
    },
)

/** Helper to check if a scenario/step is currently running */
export const isInvocationRunningAtom = atom((get) => {
    const running = get(runningInvocationsAtom)
    return (scenarioId: string, stepKey: string) => running.has(`${scenarioId}:${stepKey}`)
})
