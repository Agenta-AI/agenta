import {memo, useMemo} from "react"

import type {MessageContent} from "@agenta/shared/types"
import {getAttachments} from "@agenta/shared/utils"

import ImagePreview from "../components/presentational/attachments/ImagePreview"

import {DEFAULT_ROLE_COLOR_CLASS, ROLE_COLOR_CLASSES} from "./constants"
import {
    extractChatMessages,
    normalizeChatMessages,
    selectPreviewChatMessages,
    truncateContent,
    tryParseJson,
    type ChatExtractionPreference,
    type ChatPreviewStrategy,
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
    /** Strategy for selecting the truncated table preview */
    previewStrategy?: ChatPreviewStrategy
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
        const textParts = content
            .map((entry: unknown) => {
                const part = entry as Record<string, unknown> | null
                return part?.type === "text" && typeof part.text === "string" ? part.text : null
            })
            .filter((part): part is string => Boolean(part?.trim()))

        if (textParts.length > 0) {
            return textParts.join("\n\n")
        }

        const hasAttachmentParts = content.some((entry: unknown) => {
            const part = entry as Record<string, unknown> | null
            return part?.type === "image_url" || part?.type === "file"
        })
        if (hasAttachmentParts) return ""
    }
    // Use compact JSON (no pretty printing) to minimize rendered lines
    try {
        return JSON.stringify(content)
    } catch {
        return String(content)
    }
}

const getImageUrls = (content: unknown): string[] => {
    if (!Array.isArray(content)) return []

    return getAttachments(content as MessageContent)
        .filter((attachment) => attachment.type === "image_url")
        .map((attachment) => attachment.image_url?.url?.trim())
        .filter((url): url is string => Boolean(url))
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
        const imageUrls = useMemo(() => getImageUrls(message.content), [message.content])
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
                {imageUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        {imageUrls.map((imageUrl, imageIndex) => (
                            <ImagePreview
                                key={`${keyPrefix}-${index}-image-${imageIndex}`}
                                src={imageUrl}
                                alt={`Message attachment ${imageIndex + 1}`}
                                size={truncate ? 36 : 56}
                            />
                        ))}
                    </div>
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
        previewStrategy,
    }: ChatMessagesCellContentProps) => {
        // Memoize message extraction and smart selection together
        const {displayMessages, totalCount} = useMemo(() => {
            // Parse JSON string if needed, otherwise use value directly
            const parsed = typeof value === "string" ? tryParseJson(value).parsed : value
            const extracted = extractChatMessages(parsed, {prefer: chatPreference})
            if (!extracted) return {displayMessages: [], totalCount: 0}

            // Smart selection: pick messages that fit within line budget
            const {selected, totalCount: total} = selectPreviewChatMessages(extracted, {
                maxTotalLines: maxTotalLines ?? 0,
                maxLinesPerMessage: maxLines,
                strategy: truncate ? previewStrategy : "first",
            })

            // Only normalize the selected messages
            const normalized = normalizeChatMessages(selected)

            return {displayMessages: normalized, totalCount: total}
        }, [value, maxTotalLines, maxLines, chatPreference, previewStrategy, truncate])

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
