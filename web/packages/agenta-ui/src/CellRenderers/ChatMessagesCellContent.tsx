import {memo, useMemo} from "react"

import {DEFAULT_ROLE_COLOR_CLASS, ROLE_COLOR_CLASSES} from "./constants"
import {
    extractChatMessages,
    normalizeChatMessages,
    truncateContent,
    tryParseJson,
    type ChatExtractionPreference,
} from "./utils"

interface ChatMessagesCellContentProps {
    /** Value that may contain chat messages */
    value: unknown
    /** Unique key prefix for React keys */
    keyPrefix: string
    /** Max lines per message when truncated */
    maxLines?: number
    /** Max total lines for the entire cell (used to calculate how many messages fit) */
    maxTotalLines?: number
    /** Whether to truncate content (default: true for cell, false for popover) */
    truncate?: boolean
    /** Show dividers between messages */
    showDividers?: boolean
    /** Hint for chat extraction direction in mixed payloads */
    chatPreference?: ChatExtractionPreference
}

/**
 * Format tool calls for display
 */
const formatToolCalls = (toolCalls: unknown[]): string => {
    return toolCalls
        .map((tc: unknown) => {
            const toolCall = tc as Record<string, unknown> | null
            const fn = toolCall?.function as Record<string, unknown> | undefined
            const name = fn?.name || toolCall?.name || "tool"
            const args = fn?.arguments || toolCall?.arguments || ""
            return `${name}(${typeof args === "string" ? args : JSON.stringify(args)})`
        })
        .join("\n")
}

/**
 * Get content as string for display - uses compact JSON to minimize lines
 */
const getContentString = (content: unknown): string => {
    if (content === null || content === undefined) return ""
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        // Handle OpenAI content array format
        const textPart = content.find((c: unknown) => {
            const part = c as Record<string, unknown> | null
            return part?.type === "text"
        }) as Record<string, unknown> | undefined
        if (textPart?.text) return String(textPart.text)
    }
    // Use compact JSON (no pretty printing) to minimize rendered lines
    try {
        return JSON.stringify(content)
    } catch {
        return String(content)
    }
}

interface SingleMessageProps {
    message: {role: string; content: unknown; tool_calls?: unknown[]}
    keyPrefix: string
    index: number
    truncate: boolean
    maxLines: number
    showDivider: boolean
}

// Chars per line estimate - use generous value to fill wider columns
// Actual truncation is controlled by maxLines, this just sets max chars
const CHARS_PER_LINE = 80

/**
 * Renders a single chat message
 */
const SingleMessage = memo(
    ({message, keyPrefix, index, truncate, maxLines, showDivider}: SingleMessageProps) => {
        const contentString = useMemo(() => getContentString(message.content), [message.content])
        // Calculate max chars based on maxLines to prevent overflow
        const maxChars = maxLines * CHARS_PER_LINE
        const displayContent = useMemo(
            () => (truncate ? truncateContent(contentString, maxLines, maxChars) : contentString),
            [contentString, truncate, maxLines, maxChars],
        )
        const roleColorClass =
            ROLE_COLOR_CLASSES[message.role.toLowerCase()] ?? DEFAULT_ROLE_COLOR_CLASS

        return (
            <section key={`${keyPrefix}-${index}`} className="w-full flex flex-col gap-1 text-xs">
                <span className={`capitalize text-xs font-medium ${roleColorClass}`}>
                    {message.role}
                </span>
                {displayContent && (
                    <span className="whitespace-pre-wrap break-words block">{displayContent}</span>
                )}
                {message.tool_calls && message.tool_calls.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium">Tool Calls:</span>
                        <span className="whitespace-pre-wrap break-words text-xs bg-zinc-1 rounded px-2 py-1 block">
                            {formatToolCalls(message.tool_calls)}
                        </span>
                    </div>
                )}
                {showDivider && <div className="h-px w-full bg-zinc-2 rounded-full mt-1" />}
            </section>
        )
    },
)
SingleMessage.displayName = "SingleMessage"

/**
 * Select messages that fit within maxTotalLines budget
 * Each message takes: 1 line for role + content lines (capped by maxLinesPerMessage)
 */
const selectMessagesToFit = (
    messages: unknown[],
    maxTotalLines: number,
    maxLinesPerMessage: number,
): {selected: unknown[]; totalCount: number} => {
    const totalCount = messages.length
    if (!maxTotalLines) {
        return {selected: messages, totalCount}
    }

    const selected: unknown[] = []
    let usedLines = 0
    const ROLE_LINE = 1

    for (const msg of messages) {
        // Each message will use at most: 1 role line + maxLinesPerMessage content lines
        // Content is truncated to maxLinesPerMessage * CHARS_PER_LINE chars
        const msgLines = ROLE_LINE + maxLinesPerMessage

        if (usedLines + msgLines > maxTotalLines) {
            break
        }

        selected.push(msg)
        usedLines += msgLines
    }

    // Always show at least one message
    if (selected.length === 0 && messages.length > 0) {
        selected.push(messages[0])
    }

    return {selected, totalCount}
}

/**
 * Renders chat messages (OpenAI format) as lightweight plain text blocks.
 * Uses plain HTML elements instead of heavy editor components for performance.
 *
 * Features:
 * - Auto-detects chat message arrays in various formats
 * - Role-based color coding
 * - Tool calls display
 * - Truncation for cell preview
 *
 * Returns null if value doesn't contain chat messages.
 */
const ChatMessagesCellContent = memo(
    ({
        value,
        keyPrefix,
        maxLines = 4,
        maxTotalLines,
        truncate = true,
        showDividers = true,
        chatPreference,
    }: ChatMessagesCellContentProps) => {
        // Memoize message extraction and smart selection together
        const {displayMessages, totalCount} = useMemo(() => {
            // Parse JSON string if needed, otherwise use value directly
            const parsed = typeof value === "string" ? tryParseJson(value).parsed : value
            const extracted = extractChatMessages(parsed, {prefer: chatPreference})
            if (!extracted) return {displayMessages: [], totalCount: 0}

            // Smart selection: pick messages that fit within line budget
            const {selected, totalCount: total} = selectMessagesToFit(
                extracted,
                maxTotalLines ?? 0,
                maxLines,
            )

            // Only normalize the selected messages
            const normalized = normalizeChatMessages(selected)

            return {displayMessages: normalized, totalCount: total}
        }, [value, maxTotalLines, maxLines, chatPreference])

        if (displayMessages.length === 0) {
            return null
        }

        const hasMore = maxTotalLines && totalCount > displayMessages.length

        return (
            <div className="flex w-full flex-col gap-2">
                {displayMessages.map((msg, i) => (
                    <SingleMessage
                        key={`${keyPrefix}-${i}`}
                        message={msg}
                        keyPrefix={keyPrefix}
                        index={i}
                        truncate={truncate}
                        maxLines={maxLines}
                        showDivider={showDividers && i < displayMessages.length - 1 && !hasMore}
                    />
                ))}
                {hasMore && (
                    <span className="text-xs italic">
                        +{totalCount - displayMessages.length} more message
                        {totalCount - displayMessages.length > 1 ? "s" : ""}
                    </span>
                )}
            </div>
        )
    },
)
ChatMessagesCellContent.displayName = "ChatMessagesCellContent"

export default ChatMessagesCellContent
