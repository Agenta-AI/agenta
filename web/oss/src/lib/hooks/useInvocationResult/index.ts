import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/components/common/renderChatMessages"
import {readInvocationResponse} from "@/oss/lib/helpers/traceUtils"
import {scenarioStatusAtomFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import useEvalRunScenarioData from "@/oss/lib/hooks/useEvaluationRunData/useEvalRunScenarioData"

import type {UseInvocationResultArgs, UseInvocationResult} from "./types"

export function useInvocationResult({
    scenarioId,
    stepKey,
}: UseInvocationResultArgs): UseInvocationResult {
    const data = useEvalRunScenarioData(scenarioId)

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

    // Determine chat vs primitive
    let messageNodes: React.ReactNode[] | null = null
    let value: string | object | undefined = undefined

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
        } else if (typeof rawValue === "object" && "role" in rawValue && "content" in rawValue) {
            messageNodes = renderChatMessages(
                `${scenarioId}-${stepKey}`,
                JSON.stringify([rawValue]),
            )
        } else {
            value = rawValue as any
        }
    }

    if (!messageNodes) {
        value = value ?? derivedVal
    }

    return {trace, value, rawValue, messageNodes, status}
}
