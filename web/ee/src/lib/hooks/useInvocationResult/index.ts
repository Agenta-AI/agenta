import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/assets/renderChatMessages"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {useRunId} from "@/oss/contexts/RunIdContext"
import {readInvocationResponse} from "@/oss/lib/helpers/traceUtils"

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

    const {
        trace: _trace,
        value: derivedVal,
        rawValue,
    } = readInvocationResponse({
        scenarioData: data,
        stepKey,
        forceTrace: status?.trace,
        optimisticResult: status?.result,
        scenarioId,
    })

    const trace = status?.trace || _trace
    // For auto evaluation only
    const errorMessage = useMemo(() => {
        if (evalType !== "auto") return ""
        const findInvocation = data?.invocationSteps?.find((d) => d.scenarioId === scenarioId)
        return findInvocation?.error?.stacktrace ?? ""
    }, [data, scenarioId, evalType])

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
    }, [trace, errorMessage])

    return {trace, value, rawValue, messageNodes, status, hasError}
}
