/**
 * Atom for handling run invocation actions in evaluation scenarios.
 * This provides a global action that can be triggered from table cells
 * without needing to use hooks in each cell.
 */

import {atom} from "jotai"
import {getDefaultStore} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {runInvocation} from "@/oss/services/evaluations/invocations/api"
import {fetchVariantConfig} from "@/oss/services/variantConfigs/api"
import {getProjectValues} from "@/oss/state/project"

import {evaluationMetricQueryAtomFamily, invalidateMetricBatcherCache} from "./metrics"
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

/**
 * Prepare the request body for an invocation.
 * This follows the legacy prepareRequest logic:
 * - messages go to top-level for chat variants
 * - other inputs go under `inputs` for non-custom variants
 * - custom variants get all inputs at top level
 */
const prepareRequestBody = ({
    inputParametersDict,
    precomputedParameters,
    appType,
}: {
    inputParametersDict: Record<string, any>
    precomputedParameters?: Record<string, any>
    appType?: string
}): Record<string, any> => {
    const isChatVariant = Object.prototype.hasOwnProperty.call(
        inputParametersDict || {},
        "messages",
    )
    const isCustomVariant = !!appType && appType === "custom"

    const mainInputParams: Record<string, any> = {}
    const secondaryInputParams: Record<string, string> = {}

    // Split inputs: messages => top-level, everything else => under `inputs`
    Object.keys(inputParametersDict).forEach((key) => {
        const val = inputParametersDict[key]
        if (key === "messages") {
            mainInputParams[key] = val
        } else {
            secondaryInputParams[key] = val
        }
    })

    // Start from stable precomputed parameters (main-thread transformed prompts)
    const baseParams = precomputedParameters || {}
    const requestBody: Record<string, any> = {
        ...baseParams,
        ...mainInputParams,
    }

    if (isCustomVariant) {
        for (const key of Object.keys(inputParametersDict)) {
            if (key !== "inputs") requestBody[key] = inputParametersDict[key]
        }
    } else {
        requestBody["inputs"] = {...(requestBody["inputs"] || {}), ...secondaryInputParams}
    }

    if (isChatVariant) {
        if (typeof requestBody["messages"] === "string") {
            try {
                requestBody["messages"] = JSON.parse(requestBody["messages"])
            } catch {
                throw new Error("content not valid for messages")
            }
        }
    }

    return requestBody
}

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
            console.log("[runInvocationAction] Run index:", {
                runIndex,
                invocationKeys: runIndex?.invocationKeys,
                steps: runIndex?.steps,
            })

            const invocationKeys = Array.from(runIndex?.invocationKeys ?? [])
            const primaryInvocationKey = invocationKeys[0]
            const invocationStepMeta = primaryInvocationKey
                ? runIndex?.steps?.[primaryInvocationKey]
                : undefined
            const refs = invocationStepMeta?.refs ?? {}

            console.log("[runInvocationAction] Invocation step meta:", {
                primaryInvocationKey,
                invocationStepMeta,
                refs,
            })

            // Extract IDs from references
            const appId =
                refs.application?.id || refs.application?.app_id || refs.application_ref?.id || ""

            const revisionId =
                refs.application_revision?.id ||
                refs.applicationRevision?.id ||
                refs.revision?.id ||
                ""

            console.log("[runInvocationAction] Extracted IDs:", {appId, revisionId})

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

            // Fetch variant config directly from API (includes params and URL)
            const {projectId} = getProjectValues()
            if (!projectId) {
                message.error("Project ID not available")
                return {success: false, error: "Project ID not available"}
            }

            console.log("[runInvocationAction] Fetching variant config...", {
                projectId,
                appId,
                revisionId,
            })

            const variantConfig = await fetchVariantConfig({
                projectId,
                application: {id: appId},
                variant: {id: revisionId},
            })

            console.log("[runInvocationAction] Variant config:", variantConfig)

            if (!variantConfig) {
                message.error("Failed to fetch variant configuration")
                return {success: false, error: "Variant config not available"}
            }

            const appUrl = variantConfig.url
            if (!appUrl) {
                console.error("[runInvocationAction] App URL not in variant config:", variantConfig)
                message.error("App URL not available in variant config")
                return {success: false, error: "App URL not available"}
            }

            // Get stable parameters from variant config
            const stableParams = variantConfig.params ?? {}
            console.log("[runInvocationAction] Stable params from config:", stableParams)

            // Get input data from the scenario's input step
            const stepsQuery = get(scenarioStepsQueryFamily({scenarioId, runId}))
            const steps = stepsQuery.data?.steps ?? []
            console.log("[runInvocationAction] Scenario steps:", {stepsQuery, steps})

            // Find the input step and get the testcase ID
            const inputKeys = runIndex?.inputKeys ?? new Set()
            console.log("[runInvocationAction] Looking for input step:", {
                inputKeys: Array.from(inputKeys),
                allStepKeys: steps.map((s: any) => s.stepKey),
            })
            const inputStep = steps.find((step: any) => inputKeys.has(step.stepKey ?? ""))
            const testcaseId = inputStep?.testcaseId ?? inputStep?.testcase_id
            console.log("[runInvocationAction] Input step found:", {
                inputStep,
                testcaseId,
            })

            // Fetch the testcase data using the testcase ID
            let inputData: Record<string, any> = {}
            if (testcaseId) {
                try {
                    const testcaseResponse = await axios.post(
                        `/preview/testcases/query`,
                        {testcase_ids: [testcaseId]},
                        {params: {project_id: projectId}},
                    )
                    const testcases = testcaseResponse.data?.testcases ?? []
                    const testcase = testcases[0]
                    inputData = testcase?.data ?? testcase?.inputs ?? {}
                    console.log("[runInvocationAction] Fetched testcase data:", {
                        testcase,
                        inputData,
                    })
                } catch (err) {
                    console.error("[runInvocationAction] Failed to fetch testcase:", err)
                }
            } else {
                // Fallback to step data if no testcase ID
                inputData = inputStep?.data ?? inputStep?.inputs ?? {}
                console.log("[runInvocationAction] Using step data as fallback:", inputData)
            }

            // Build request body using the legacy prepareRequest logic
            // Note: appType is not available here, but prepareRequestBody handles undefined gracefully
            const requestBody = prepareRequestBody({
                inputParametersDict: inputData,
                precomputedParameters: stableParams,
                appType: undefined,
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

            // Run the invocation
            const result = await runInvocation({
                runId,
                scenarioId,
                stepKey,
                appUrl,
                appId,
                requestBody,
                references,
            })

            if (result.success) {
                message.success("Invocation completed successfully")

                // Invalidate all relevant caches to force fresh data
                invalidateScenarioStepsBatcherCache()
                invalidateTraceBatcherCache()
                invalidateMetricBatcherCache()

                // Trigger metrics refresh for this scenario
                try {
                    await axios.post(
                        `/preview/evaluations/metrics/refresh`,
                        {
                            metrics: {
                                run_id: runId,
                                scenario_id: scenarioId,
                            },
                        },
                        {params: {project_id: projectId}},
                    )
                    console.log("[runInvocationAction] Metrics refresh triggered")
                } catch (metricsError) {
                    console.warn("[runInvocationAction] Metrics refresh failed:", metricsError)
                }

                // Refetch the scenario steps and metrics to update the UI
                const stepsQueryAtom = scenarioStepsQueryFamily({scenarioId, runId})
                const stepsQuery = store.get(stepsQueryAtom)
                await stepsQuery.refetch?.()

                const metricQueryAtom = evaluationMetricQueryAtomFamily({scenarioId, runId})
                const metricQuery = store.get(metricQueryAtom)
                await metricQuery.refetch?.()

                console.log("[runInvocationAction] Caches invalidated and data refetched")
            } else {
                message.error(`Invocation failed: ${result.error}`)
            }

            return result
        } catch (error: any) {
            console.error("[runInvocationAction] Error:", error)
            message.error(`Failed to run invocation: ${error?.message || "Unknown error"}`)
            return {success: false, error: error?.message || "Unknown error"}
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
