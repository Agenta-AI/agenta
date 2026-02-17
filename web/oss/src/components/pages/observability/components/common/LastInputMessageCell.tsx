import {memo, useMemo} from "react"

import {
    CellContentPopover,
    ChatMessagesCellContent,
    SmartCellContent,
    extractChatMessages,
    safeJsonStringify,
    tryParseJson,
} from "@agenta/ui/cell-renderers"

interface LastInputMessageCellProps {
    value: unknown
    keyPrefix: string
    className?: string
    maxLines?: number
}

const LastInputMessageCell = ({
    value,
    keyPrefix,
    className = "",
    maxLines = 4,
}: LastInputMessageCellProps) => {
    const {parsed} = useMemo(() => tryParseJson(value), [value])
    const messages = useMemo(() => extractChatMessages(parsed, {prefer: "input"}), [parsed])
    const copyText = useMemo(() => safeJsonStringify(parsed), [parsed])

    if (!messages || messages.length === 0) {
        return (
            <SmartCellContent
                value={value}
                maxLines={maxLines}
                className={className}
                chatPreference="input"
            />
        )
    }

    const lastMessageOnly = [messages[messages.length - 1]]

    return (
        <CellContentPopover
            fullContent={
                <ChatMessagesCellContent
                    value={messages}
                    keyPrefix={`${keyPrefix}-popover`}
                    truncate={false}
                />
            }
            copyText={copyText}
        >
            <div className={`cursor-pointer ${className}`}>
                <ChatMessagesCellContent
                    value={lastMessageOnly}
                    keyPrefix={`${keyPrefix}-last`}
                    maxLines={maxLines}
                    maxTotalLines={maxLines + 1}
                    truncate
                    showDividers={false}
                />
            </div>
        </CellContentPopover>
    )
}

export default memo(LastInputMessageCell)
