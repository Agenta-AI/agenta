import {useMemo} from "react"

interface AssistantLike {
    function_call?: unknown
    tool_call?: unknown
    tool_calls?: unknown[]
    toolCalls?: {value?: unknown[]}
}

const useHasAssistantContent = (
    assistant: AssistantLike | null | undefined,
    displayAssistantValue?: string | null,
    hasToolCallsOverride?: boolean,
) => {
    return useMemo(() => {
        const txt = (displayAssistantValue || "").trim()
        const hasTools = Boolean(
            (assistant as any)?.function_call ||
            (assistant as any)?.tool_call ||
            (Array.isArray((assistant as any)?.toolCalls?.value) &&
                (((assistant as any)?.toolCalls?.value as any[])?.length || 0) > 0) ||
            (Array.isArray((assistant as any)?.tool_calls) &&
                (((assistant as any)?.tool_calls as any[])?.length || 0) > 0),
        )

        return Boolean(txt) || hasTools || Boolean(hasToolCallsOverride)
    }, [
        displayAssistantValue,
        (assistant as any)?.function_call,
        (assistant as any)?.tool_call,
        (assistant as any)?.toolCalls?.value,
        (assistant as any)?.tool_calls,
        hasToolCallsOverride,
    ])
}

export default useHasAssistantContent
