import {useEffect, useMemo, useState} from "react"

import {useAtomValue} from "jotai"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/assets/renderChatMessages"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {useRunId} from "@/oss/contexts/RunIdContext"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {readInvocationResponse} from "@/oss/lib/helpers/traceUtils"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {getCurrentRunId} from "../useEvaluationRunData/assets/atoms/migrationHelper"
import {scenarioStatusAtomFamily} from "../useEvaluationRunData/assets/atoms/progress"
import useEvalRunScenarioData from "../useEvaluationRunData/useEvalRunScenarioData"

import type {UseInvocationResult, UseInvocationResultArgs} from "./types"

export function useInvocationResult({
    scenarioId,
    stepKey,
    runId: maybeRunId,
    editorType = "shared",
    viewType = "single",
}: UseInvocationResultArgs): UseInvocationResult {
    // Use provided runId or fallback to current run context (memoized to prevent infinite loops)
    const contextRunId = useRunId()
    const runId = useMemo(() => {
        if (maybeRunId) return maybeRunId
        if (contextRunId) return contextRunId
        try {
            return getCurrentRunId()
        } catch (error) {
            console.warn("[useInvocationResult] No run ID available:", error)
            return null
        }
    }, [maybeRunId, contextRunId])

    const evalType = useAtomValue(evalTypeAtom)
    const projectId = useAtomValue(projectIdAtom)
    // Call all hooks before any early returns
    const data = useEvalRunScenarioData(scenarioId, runId || "")

    // Read from the same global store that writes are going to
    const status = useAtomValue(
        useMemo(
            () => scenarioStatusAtomFamily({scenarioId, runId: runId || ""}),
            [scenarioId, runId],
        ),
    ) as any

    // Early return if no runId is available
    if (!runId) {
        return {
            trace: undefined,
            value: undefined,
            rawValue: undefined,
            messageNodes: null,
            status: undefined,
        }
    }

    const [remoteStep, setRemoteStep] = useState<any>(null)
    const [remoteError, setRemoteError] = useState<any>(null)
    const [remoteTrace, setRemoteTrace] = useState<any>(null)
    const [remoteTraceError, setRemoteTraceError] = useState<any>(null)

    useEffect(() => {
        if (!runId || !scenarioId || !stepKey || !projectId) return
        if (remoteStep || remoteError) return
        if (status?.trace) return

        const existing = data?.invocationSteps?.find((step) => step.stepKey === stepKey)
        if (existing && (existing.trace || existing.data)) return

        let aborted = false
        ;(async () => {
            try {
                const response = await axios.post(
                    `/preview/evaluations/results/query?project_id=${projectId}`,
                    {
                        result: {
                            run_ids: [runId],
                            scenario_ids: [scenarioId],
                            step_keys: [stepKey],
                        },
                        windowing: {limit: 1},
                    },
                )
                if (aborted) return
                const payload = response.data || {}
                const list: any[] = Array.isArray(payload.results)
                    ? payload.results
                    : Array.isArray(payload.steps)
                      ? payload.steps
                      : []
                const match = list.find((item) => {
                    const key = item?.step_key || item?.stepKey
                    const sid = item?.scenario_id || item?.scenarioId
                    return (!key || key === stepKey) && (!sid || sid === scenarioId)
                })
                if (match) {
                    const normalized = snakeToCamelCaseKeys(match)
                    normalized.stepKey = normalized.stepKey || stepKey
                    normalized.scenarioId = normalized.scenarioId || scenarioId
                    setRemoteStep(normalized)
                } else {
                    setRemoteError(new Error("No invocation result found"))
                }
            } catch (error) {
                if (!aborted) setRemoteError(error)
            }
        })()
        return () => {
            aborted = true
        }
    }, [
        runId,
        scenarioId,
        stepKey,
        projectId,
        data?.invocationSteps,
        status?.trace,
        remoteStep,
        remoteError,
    ])

    useEffect(() => {
        if (!remoteStep || remoteStep.trace) return
        if (remoteTrace || remoteTraceError) return
        const traceId: string | undefined = remoteStep.traceId || remoteStep.trace_id
        if (!traceId || !projectId) return

        let cancelled = false
        ;(async () => {
            try {
                const filtering = JSON.stringify({
                    conditions: [{key: "tree.id", operator: "in", value: [traceId]}],
                })
                const response = await axios.get("/observability/v1/traces", {
                    params: {project_id: projectId, filtering, limit: 1},
                })
                if (cancelled) return
                const tree = response?.data?.trees?.[0]
                if (tree) {
                    setRemoteTrace(tree)
                } else {
                    setRemoteTraceError(new Error("Trace not found"))
                }
            } catch (error) {
                if (!cancelled) setRemoteTraceError(error)
            }
        })()

        return () => {
            cancelled = true
        }
    }, [remoteStep, remoteTrace, remoteTraceError, projectId])

    const scenarioDataWithFallback = useMemo(() => {
        const baseData = data || {}
        if (!remoteStep) return baseData

        const existingSteps = Array.isArray(baseData.invocationSteps)
            ? baseData.invocationSteps
            : []
        const matchedIndex = existingSteps.findIndex((step) => step.stepKey === remoteStep.stepKey)

        const remoteTraceValue = remoteStep.trace || remoteTrace
        if (matchedIndex >= 0) {
            if (remoteTraceValue && !existingSteps[matchedIndex]?.trace) {
                const mergedStep = {
                    ...existingSteps[matchedIndex],
                    trace: remoteTraceValue,
                }
                const mergedSteps = [...existingSteps]
                mergedSteps[matchedIndex] = mergedStep
                return {
                    ...baseData,
                    invocationSteps: mergedSteps,
                }
            }
            return baseData
        }

        const enriched = remoteTraceValue ? {...remoteStep, trace: remoteTraceValue} : remoteStep
        return {
            ...baseData,
            invocationSteps: [enriched, ...existingSteps],
        }
    }, [data, remoteStep, remoteTrace])

    const {
        trace: _trace,
        value: derivedVal,
        rawValue,
    } = readInvocationResponse({
        scenarioData: scenarioDataWithFallback,
        stepKey,
        forceTrace: status?.trace,
        optimisticResult: status?.result,
        scenarioId,
        evalType,
    })

    const trace = status?.trace || _trace
    // For auto evaluation only
    const errorMessage = useMemo(() => {
        if (evalType !== "auto") return ""
        const findInvocation = scenarioDataWithFallback?.invocationSteps?.find(
            (d) => d.scenarioId === scenarioId,
        )
        return findInvocation?.error?.stacktrace ?? ""
    }, [scenarioDataWithFallback, scenarioId, evalType])

    const {messageNodes, value, hasError} = useMemo(() => {
        // Determine chat vs primitive
        let messageNodes: React.ReactNode[] | null = null
        let value: string | object | undefined = undefined
        let hasError = false

        if (trace?.exception) {
            value = trace?.exception?.message
            hasError = true
        } else if (errorMessage) {
            value = errorMessage
            hasError = true
        } else {
            const processChat = (jsonStr: string) => {
                try {
                    const arr = JSON.parse(jsonStr)
                    if (
                        Array.isArray(arr) &&
                        arr.every((m: any) => "role" in m && "content" in m)
                    ) {
                        return renderChatMessages({
                            keyPrefix: `${scenarioId}-${stepKey}`,
                            rawJson: jsonStr,
                            view: viewType,
                            editorType,
                        })
                    }

                    return null
                } catch (err) {}
            }

            if (rawValue) {
                if (typeof rawValue === "string") {
                    messageNodes = processChat(rawValue)
                    if (!messageNodes) value = rawValue
                } else if (
                    typeof rawValue === "object" &&
                    "role" in rawValue &&
                    "content" in rawValue
                ) {
                    messageNodes = renderChatMessages({
                        keyPrefix: `${scenarioId}-${stepKey}-${trace?.trace_id ?? ""}`,
                        rawJson: JSON.stringify([rawValue]),
                        view: viewType,
                        editorType,
                    })
                } else {
                    value = rawValue as any
                }
            }

            if (!messageNodes) {
                value = value ?? derivedVal
            }
        }

        return {messageNodes, value, hasError}
    }, [trace, errorMessage, rawValue, derivedVal, scenarioId, stepKey, viewType, editorType])

    return {trace, value, rawValue, messageNodes, status, hasError}
}
