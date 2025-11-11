import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/assets/renderChatMessages"
import {readInvocationResponse} from "@/oss/lib/helpers/traceUtils"
import {scenarioStatusAtomFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import useEvalRunScenarioData from "@/oss/lib/hooks/useEvaluationRunData/useEvalRunScenarioData"

import type {UseInvocationResult, UseInvocationResultArgs} from "./types"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"

export function useInvocationResult({
    scenarioId,
    stepKey,
    editorType = "shared",
    viewType = "single",
}: UseInvocationResultArgs): UseInvocationResult {
    const data = useEvalRunScenarioData(scenarioId)

    const evalType = useAtomValue(evalTypeAtom)
    const status = useAtomValue(
        useMemo(() => scenarioStatusAtomFamily(scenarioId), [scenarioId]),
    ) as any

    const {
        trace: _trace,
        value: derivedVal,
        rawValue,
    } = readInvocationResponse({
        scenarioData: data,
        stepKey,
        forceTrace: status?.trace,
        optimisticResult: status?.result,
    })

    const trace = status?.trace || _trace
    // For auto evaluation only
    const errorMessage = useMemo(() => {
        if (evalType !== "auto") return ""
        const findInvocation = data?.invocationSteps?.find((d) => d.scenarioId === scenarioId)
        return findInvocation?.error?.stacktrace ?? ""
    }, [data, scenarioId, evalType])

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
                if (Array.isArray(arr) && arr.every((m: any) => "role" in m && "content" in m)) {
                    return renderChatMessages(`${scenarioId}-${stepKey}`, jsonStr)
                }
            } catch {
                /* ignore */
            }
            return null
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
                    keyPrefix: `${scenarioId}-${stepKey}`,
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

    return {trace, value, rawValue, messageNodes, status, hasError}
}
