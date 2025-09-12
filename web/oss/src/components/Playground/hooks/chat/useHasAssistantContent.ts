import {useMemo} from "react"

interface AssistantLike {
    function_call?: unknown
    tool_call?: unknown
    tool_calls?: unknown[]
}

const useHasAssistantContent = (
    assistant: AssistantLike | null | undefined,
    displayAssistantValue?: string | null,
) => {
    return useMemo(() => {
        const txt = (displayAssistantValue || "").trim()
        const hasTools = Boolean(
            (assistant as any)?.function_call ||
                (assistant as any)?.tool_call ||
                (Array.isArray((assistant as any)?.tool_calls) &&
                    (((assistant as any)?.tool_calls as any[])?.length || 0) > 0),
        )

        return Boolean(txt) || hasTools
    }, [
        displayAssistantValue,
        (assistant as any)?.function_call,
        (assistant as any)?.tool_call,
        (assistant as any)?.tool_calls,
    ])
}

export default useHasAssistantContent
