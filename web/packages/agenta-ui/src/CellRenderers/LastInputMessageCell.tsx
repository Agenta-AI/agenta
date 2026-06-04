import {memo, useMemo} from "react"

import CellContentPopover from "./CellContentPopover"
import ChatMessagesCellContent from "./ChatMessagesCellContent"
import {extractPreview} from "./extractPreview"
import SmartCellContent from "./SmartCellContent"
import {safeJsonStringify} from "./utils"

interface LastInputMessageCellProps {
    value: unknown
    keyPrefix: string
    className?: string
    maxLines?: number
}

/**
 * Renders the last user input message from a chat messages array.
 *
 * In a table cell, shows only the last message (most recent/relevant).
 * On hover, shows the full conversation in a popover with copy support.
 *
 * For non-chat values, delegates to SmartCellContent so the new dispatch rules
 * (e.g. pretty extraction) apply.
 */
const LastInputMessageCell = ({
    value,
    keyPrefix,
    className = "",
    maxLines = 4,
}: LastInputMessageCellProps) => {
    const preview = useMemo(() => extractPreview(value, "input"), [value])

    if (preview.renderer !== "chat" || preview.data.length === 0) {
        return (
            <SmartCellContent
                value={value}
                maxLines={maxLines}
                className={className}
                chatPreference="input"
            />
        )
    }

    const messages = preview.data
    const lastMessageOnly = [messages[messages.length - 1]]
    const copyText = safeJsonStringify(messages)

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
