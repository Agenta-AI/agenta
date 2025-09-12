import React from "react"

import PromptMessageConfig from "@/oss/components/Playground/Components/PromptMessageConfig"
import ToolCallView from "@/oss/components/Playground/Components/ToolCallView"

const AssistantMessageBlock: React.FC<{
    variantId?: string
    turnId: string
    assistantMessage: any
    displayAssistantValue?: string
    result: any
    resultHash?: string | null
    toolCallsView?: {title?: string; json: string} | undefined
    editable?: boolean
    footer: any
    messageProps: any
    onDelete?: () => void
    onRerun?: () => void
}> = ({
    variantId,
    turnId,
    assistantMessage,
    displayAssistantValue,
    result,
    resultHash,
    toolCallsView,
    editable,
    footer,
    viewOnly,
    messageProps,
    onDelete,
    onRerun,
    ...props
}) => {
    if (!displayAssistantValue && !toolCallsView) return null

    return toolCallsView ? (
        <>
            {/* <ToolCallView resultData={result?.response?.data} className="w-full" /> */}
            {result ? <></> : null}
        </>
    ) : (
        <PromptMessageConfig
            key={`${turnId}-assistant-${resultHash || "idle"}`}
            variantId={variantId as string}
            rowId={turnId}
            messageId={`${turnId}-assistant`}
            message={assistantMessage as any}
            initialValue={displayAssistantValue || ""}
            disabled={!editable}
            runnable={Boolean(editable)}
            rerunMessage={() => onRerun?.()}
            allowFileUpload={false}
            className="w-full [&_.agenta-rich-text-editor]:min-h-0"
            footer={footer}
            viewOnly={viewOnly}
            deleteMessage={onDelete ? () => onDelete() : undefined}
            {...messageProps}
            {...props}
        />
    )
}

export default AssistantMessageBlock
