import {useCallback, useState} from "react"

import {v4 as uuidv4} from "uuid"

import {executeToolCall} from "@/oss/services/tools/api"
import type {ToolCallResult} from "@/oss/services/tools/api/types"

// Double-underscore separator: valid for LLM function names (no dots allowed)
// and accepted by the /tools/call API which normalises __ → . before parsing.
export const buildToolSlug = (
    provider: string,
    integration: string,
    action: string,
    connectionSlug: string,
) => `tools__${provider}__${integration}__${action}__${connectionSlug}`

export const useToolExecution = () => {
    const [isExecuting, setIsExecuting] = useState(false)
    const [result, setResult] = useState<ToolCallResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    const execute = useCallback(
        async (params: {
            provider: string
            integrationKey: string
            actionKey: string
            connectionSlug: string
            arguments: Record<string, unknown>
        }) => {
            setIsExecuting(true)
            setResult(null)
            setError(null)

            try {
                const slug = buildToolSlug(
                    params.provider,
                    params.integrationKey,
                    params.actionKey,
                    params.connectionSlug,
                )
                const response = await executeToolCall({
                    data: {
                        id: uuidv4(),
                        type: "function",
                        function: {
                            name: slug,
                            arguments: params.arguments,
                        },
                    },
                })
                setResult(response.call)
                return response.call
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Tool execution failed"
                setError(message)
                return null
            } finally {
                setIsExecuting(false)
            }
        },
        [],
    )

    const reset = useCallback(() => {
        setResult(null)
        setError(null)
    }, [])

    return {execute, isExecuting, result, error, reset}
}
