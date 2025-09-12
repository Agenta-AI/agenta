import {useMemo} from "react"

import {
    useAssistantDisplayValue,
    useToolCallsView,
} from "@/oss/components/Playground/hooks/chat/useAssistant"
import useHasAssistantContent from "@/oss/components/Playground/hooks/chat/useHasAssistantContent"

interface AssistantArtifacts {
    displayAssistantValue: string
    toolCallsView: any
    hasAssistantContent: boolean
}

const useAssistantArtifacts = (assistant: any, result: any): AssistantArtifacts => {
    const displayAssistantValue = useAssistantDisplayValue(assistant, result) || ""
    const toolCallsView = useToolCallsView(result)
    const hasAssistantContent = useHasAssistantContent(assistant, displayAssistantValue)

    return useMemo(
        () => ({displayAssistantValue, toolCallsView, hasAssistantContent}),
        [displayAssistantValue, toolCallsView, hasAssistantContent],
    )
}

export default useAssistantArtifacts
