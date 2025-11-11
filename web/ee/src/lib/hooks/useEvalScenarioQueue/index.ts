import {useCallback, useEffect, useMemo, useRef} from "react"

import {loadable} from "jotai/utils"

// import {triggerScenarioRevalidation} from "@/oss/components/EvalRunDetails/assets/annotationUtils"
// import {getCurrentProject} from "@/oss/contexts/project.context"
// import {useAppId} from "@/oss/hooks/useAppId"
// import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
// import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
// Import EE run-scoped atoms for multi-run support
import {triggerScenarioRevalidation} from "@/oss/components/EvalRunDetails/HumanEvalRun/assets/annotationUtils"
import {setOptimisticStepData} from "@/oss/components/EvalRunDetails/HumanEvalRun/assets/optimisticUtils"
import {useAppId} from "@/oss/hooks/useAppId"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runScopedAtoms"
import {useJwtRefresher} from "@/oss/lib/hooks/useJWT"
import {EvaluationStatus} from "@/oss/lib/Types"
import {slugify} from "@/oss/lib/utils/slugify"
import type {ConfigMessage, ResultMessage, RunEvalMessage} from "@/oss/lib/workers/evalRunner/types"
import {getProjectValues} from "@/oss/state/project"

// import {setOptimisticStepData} from "../../../components/EvalRunDetails/assets/optimisticUtils"
import {evalAtomStore} from "../useEvaluationRunData/assets/atoms"
import {triggerMetricsFetch} from "../useEvaluationRunData/assets/atoms/runScopedMetrics"
import {scenarioStepFamily} from "../useEvaluationRunData/assets/atoms/runScopedScenarios"
import {IInvocationStep} from "../useEvaluationRunScenarioSteps/types"

import {BatchingQueue} from "./responseQueue"

let sharedWorker: Worker | null = null
let isWorkerInitialized = false

const MAX_RETRIES = 1

export function useEvalScenarioQueue(options?: {concurrency?: number; runId?: string}) {
    const {jwt} = useJwtRefresher()
    const {runId: optionsRunId} = options || {}

    /* -------- helpers that read atoms lazily -------- */
    const getRunMeta = useCallback(() => {
        const store = evalAtomStore()
        const effectiveRunId = optionsRunId
        if (!effectiveRunId) {
            console.warn("[useEvalScenarioQueue] No runId provided, cannot get run metadata")
            return {runId: undefined, revision: undefined}
        }
        const runState = store.get(evaluationRunStateFamily(effectiveRunId))
        const run = runState?.enrichedRun
        return {
            runId: effectiveRunId,
            revision: run?.variants?.[0],
        }
    }, [optionsRunId])

    const workerRef = useRef<Worker | null>(null)
    const retryCountRef = useRef<Map<string, number>>(new Map())
    const abortedRef = useRef<Set<string>>(new Set())
    // New refs for timestamps and transitions
    const timestampsRef = useRef<Map<string, {startedAt?: number; endedAt?: number}>>(new Map())
    const transitionsRef = useRef<Map<string, {status: string; timestamp: number}[]>>(new Map())
    const appId = useAppId()

    // placeholder for batching queue ref – will init after handleResult
    const queueRef = useRef<BatchingQueue<ResultMessage>>(undefined)

    // ---- handle single worker message ----
    const handleResult = useCallback(
        (data: ResultMessage) => {
            const {runId} = getRunMeta()
            const {invocationStepTarget, invocationKey, scenarioId, status, result} = data

            if (abortedRef.current.has(scenarioId)) return
            if (!invocationStepTarget) return

            if (status === EvaluationStatus.FAILURE) {
                const retryCount = retryCountRef.current.get(scenarioId) ?? 0
                if (retryCount < MAX_RETRIES) {
                    if (!runId) return
                    const nextRetry = retryCount + 1
                    retryCountRef.current.set(scenarioId, nextRetry)
                    setOptimisticStepData(
                        scenarioId,
                        [
                            {
                                ...structuredClone(invocationStepTarget),
                                status: EvaluationStatus.RUNNING,
                            },
                        ],
                        runId,
                    )

                    workerRef.current?.postMessage({
                        type: "run-invocation",
                        jwt,
                        appId,
                        scenarioId,
                        runId,
                        requestBody: result?.requestBody ?? {},
                        endpoint: result?.endpoint ?? "",
                        apiUrl: getAgentaApiUrl(),
                        projectId: getProjectValues().projectId,
                        invocationKey,
                        invocationStepTarget,
                    })
                    return
                }
            } else {
                retryCountRef.current.delete(scenarioId)
            }

            try {
                const optimisticData: IInvocationStep = {
                    ...structuredClone(invocationStepTarget),
                    status,
                    traceId: result.traceId,
                }

                if ("invocationParameters" in invocationStepTarget) {
                    optimisticData.invocationParameters =
                        status === EvaluationStatus.SUCCESS
                            ? undefined
                            : (invocationStepTarget as IInvocationStep).invocationParameters
                }

                if (runId) {
                    // Apply optimistic updates directly to maintain loading state continuity
                    setOptimisticStepData(scenarioId, [optimisticData], runId)
                }

                // Delay the server revalidation to allow optimistic state to be visible
                // This prevents immediate overwrite of the "running" status
                triggerScenarioRevalidation(runId, scenarioId, [optimisticData])
            } catch (err) {
                console.error("Failed to trigger scenario step refetch", err)
            }

            const now = Date.now()
            const existingTransitions = transitionsRef.current.get(scenarioId) ?? []
            transitionsRef.current.set(scenarioId, [
                ...existingTransitions,
                {status, timestamp: now},
            ])
            const existingTimestamps = timestampsRef.current.get(scenarioId) ?? {}
            if (status === "pending" && existingTimestamps.startedAt === undefined) {
                timestampsRef.current.set(scenarioId, {...existingTimestamps, startedAt: now})
            }
            if (
                (status === EvaluationStatus.SUCCESS || status === EvaluationStatus.FAILURE) &&
                existingTimestamps.endedAt === undefined
            ) {
                timestampsRef.current.set(scenarioId, {...existingTimestamps, endedAt: now})

                // Trigger metrics refresh when scenario completes (success or failure)
                if (runId) {
                    triggerMetricsFetch(runId)
                }
            }
        },
        [jwt, retryCountRef, abortedRef, appId],
    )

    // initialize queue after we have stable handleResult
    if (!queueRef.current) {
        queueRef.current = new BatchingQueue<ResultMessage>((batch) => {
            batch.forEach((item) => handleResult(item.payload))
        })
    }

    useEffect(() => {
        if (!sharedWorker) {
            sharedWorker = new Worker(
                new URL("@/oss/lib/workers/evalRunner/evalRunner.worker.ts", import.meta.url),
            )
        }

        workerRef.current = sharedWorker

        if (!isWorkerInitialized) {
            const concurrency = options?.concurrency ?? 5
            const configMsg: ConfigMessage = {type: "config", maxConcurrent: concurrency}
            sharedWorker.postMessage(configMsg)
            isWorkerInitialized = true
        }

        sharedWorker.onmessage = (e: MessageEvent<ResultMessage>) => {
            handleResult(e.data)
            // if (e.data.type === "result") {
            //     queueRef.current?.push(e.data)
            // }
        }
    }, [jwt, options?.concurrency, appId])

    const enqueueScenario = useCallback(
        (scenarioId: string, stepKey?: string) => {
            const store = evalAtomStore()
            // Use run-scoped atom - runId should always be available in EE version
            if (!optionsRunId) {
                console.warn(
                    "[useEvalScenarioQueue] No runId provided, cannot get scenario step data",
                )
                return undefined
            }

            const stepLoadable = store.get(
                loadable(scenarioStepFamily({scenarioId, runId: optionsRunId})),
            )

            if (stepLoadable.state === "hasData") {
                const stepData = stepLoadable.data
                // use data safely here
                const invSteps = stepData?.invocationSteps ?? []
                const target = stepKey
                    ? invSteps.find((s) => s.stepKey === stepKey)
                    : invSteps.find((s) => s.invocationParameters)

                if (!target?.invocationParameters) return
                const {runId, revision} = getRunMeta()
                if (!jwt || !runId) return

                const invocationSteps: any[] | undefined = stepData?.invocationSteps
                let requestBody: any, endpoint: string | undefined
                let invocationStepTarget: any | undefined
                if (invocationSteps) {
                    if (stepKey) {
                        invocationStepTarget = invocationSteps.find((s) => s.stepKey === stepKey)
                    } else {
                        invocationStepTarget = invocationSteps.find((s) => s.invocationParameters)
                    }
                    if (invocationStepTarget?.invocationParameters) {
                        requestBody = structuredClone(
                            invocationStepTarget.invocationParameters?.requestBody,
                        )
                        endpoint = invocationStepTarget.invocationParameters?.endpoint
                    }
                }
                // Optimistic running override using shared helper
                queueMicrotask(() => {
                    setOptimisticStepData(
                        scenarioId,
                        [
                            {
                                ...structuredClone(invocationStepTarget),
                                status: EvaluationStatus.RUNNING,
                            },
                        ],
                        runId,
                    )
                })
                retryCountRef.current.set(scenarioId, 0)
                abortedRef.current.delete(scenarioId)

                let invocationKey: string | undefined
                if (revision) {
                    invocationKey = slugify(
                        revision.name ?? revision.variantName ?? "invocation",
                        revision.id,
                    )
                }

                // Append required references to invocation request body before sending to worker
                // invocationStepTarget is defined above in this scope
                try {
                    if (requestBody && typeof requestBody === "object") {
                        const references: Record<string, {id: string}> =
                            (requestBody.references as any) || {}

                        // Testset id – derive from graph: find input step with same testcaseId
                        let testsetId: string | undefined
                        const inputSteps: any[] | undefined = stepData?.inputSteps
                        if (Array.isArray(inputSteps) && invocationStepTarget) {
                            const matchingInput = inputSteps.find(
                                (s) => s.testcaseId === (invocationStepTarget as any).testcaseId,
                            )
                            testsetId =
                                matchingInput?.testcase?.testset_id ||
                                matchingInput?.references?.testset?.id ||
                                matchingInput?.refs?.testset?.id
                        }
                        if (testsetId) {
                            references.testset = {id: testsetId}
                        }

                        // Application related references
                        if (appId) references.application = {id: appId}
                        const variantId = revision?.variantId || revision?.id || undefined
                        if (variantId) references.application_variant = {id: String(variantId)}
                        if (revision?.id)
                            references.application_revision = {id: String(revision.id)}

                        requestBody.references = references
                    }
                } catch (err) {
                    console.error("Failed to append references to invocation payload", err)
                }

                if (endpoint) {
                    const message: RunEvalMessage = {
                        type: "run-invocation",
                        appId: appId,
                        jwt,
                        scenarioId,
                        runId,
                        requestBody,
                        endpoint,
                        invocationKey,
                        invocationStepTarget,
                        apiUrl: getAgentaApiUrl(),
                        projectId: getProjectValues().projectId,
                    }

                    workerRef.current?.postMessage(message)

                    // Update timestamps and transitions on enqueue
                    const now = Date.now()
                    const existingTransitions = transitionsRef.current.get(scenarioId) ?? []
                    transitionsRef.current.set(scenarioId, [
                        ...existingTransitions,
                        {status: "pending", timestamp: now},
                    ])
                    const existingTimestamps = timestampsRef.current.get(scenarioId) ?? {}
                    if (existingTimestamps.startedAt === undefined) {
                        timestampsRef.current.set(scenarioId, {
                            ...existingTimestamps,
                            startedAt: now,
                        })
                    }
                }
            }
        },
        [jwt, getRunMeta],
    )

    const cancelScenario = useCallback((scenarioId: string) => {
        if (process.env.NODE_ENV !== "production") {
            console.debug(`[EvalQueue] Cancelling scenario ${scenarioId}`)
        }
        abortedRef.current.add(scenarioId)
    }, [])

    return useMemo(
        () => ({
            enqueueScenario,
            cancelScenario,
        }),
        [enqueueScenario, cancelScenario],
    )
}
