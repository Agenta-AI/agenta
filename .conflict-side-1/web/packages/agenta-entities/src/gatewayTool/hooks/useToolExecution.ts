import {useCallback, useState} from "react"

import {buildGatewayToolSlug} from "@agenta/shared/utils"
import {v4 as uuidv4} from "uuid"

import {executeToolCall} from "../api"
import type {ToolResult} from "../core/types"

export const buildToolSlug = buildGatewayToolSlug

export const useToolExecution = () => {
    const [isExecuting, setIsExecuting] = useState(false)
    const [result, setResult] = useState<ToolResult | null>(null)
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
