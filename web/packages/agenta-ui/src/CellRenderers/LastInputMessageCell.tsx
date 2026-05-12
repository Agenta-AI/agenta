import {memo, useMemo} from "react"

import CellContentPopover from "./CellContentPopover"
import ChatMessagesCellContent from "./ChatMessagesCellContent"
import SmartCellContent from "./SmartCellContent"
import {extractChatMessages, safeJsonStringify, tryParseJson} from "./utils"

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
 * Falls back to SmartCellContent for non-chat values.
 */
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
