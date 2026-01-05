import {memo, useMemo} from "react"

import {Typography} from "antd"

import CellContentPopover from "./CellContentPopover"
import ChatMessagesCellContent from "./ChatMessagesCellContent"
import JsonCellContent from "./JsonCellContent"
import TextCellContent from "./TextCellContent"
import {extractChatMessages, normalizeValue, safeJsonStringify, tryParseJson} from "./utils"

const {Text} = Typography

interface SmartCellContentProps {
    /** Value to render - auto-detects type */
    value: unknown
    /** Unique key prefix for React keys (used for chat messages) */
    keyPrefix?: string
    /** Max lines to show in cell preview */
    maxLines?: number
    /** CSS class for the container */
    className?: string
    /** Whether to show popover on hover */
    showPopover?: boolean
}

/**
 * Smart cell content renderer that auto-detects value type and renders appropriately.
 *
 * Detection order:
 * 1. Empty/null → placeholder
 * 2. Chat messages array → ChatMessagesCellContent
 * 3. JSON object/array → JsonCellContent
 * 4. Plain text → TextCellContent
 *
 * Features:
 * - Auto-detection of content type
 * - Truncation for cell preview
 * - Full content in popover on hover
 * - Copy functionality in popover
 */
const SmartCellContent = memo(
    ({
        value,
        keyPrefix = "cell",
        maxLines = 10,
        className = "",
        showPopover = true,
    }: SmartCellContentProps) => {
        // Parse JSON if needed
        const {parsed: jsonValue, isJson} = useMemo(() => tryParseJson(value), [value])

        // Check for chat messages
        const chatMessages = useMemo(() => extractChatMessages(jsonValue), [jsonValue])
        const isChatMessages = chatMessages !== null && chatMessages.length > 0

        // Get display value for plain text
        const displayValue = useMemo(() => normalizeValue(value), [value])

        // Get copy text for popover
        const copyText = useMemo(() => {
            if (value === undefined || value === null) return undefined
            if (isChatMessages || isJson) return safeJsonStringify(jsonValue)
            return displayValue
        }, [value, isChatMessages, isJson, jsonValue, displayValue])

        // Handle empty values
        if (value === undefined || value === null || value === "") {
            return (
                <div className={`${className}`}>
                    <Text type="secondary" className="text-xs">
                        —
                    </Text>
                </div>
            )
        }

        // Render chat messages
        if (isChatMessages) {
            const cellContent = (
                <div className={`cursor-pointer ${className}`}>
                    <ChatMessagesCellContent
                        value={value}
                        keyPrefix={keyPrefix}
                        maxLines={4}
                        truncate
                    />
                </div>
            )

            if (!showPopover) return cellContent

            return (
                <CellContentPopover
                    fullContent={
                        <ChatMessagesCellContent
                            value={value}
                            keyPrefix={`${keyPrefix}-popover`}
                            truncate={false}
                        />
                    }
                    copyText={copyText}
                >
                    {cellContent}
                </CellContentPopover>
            )
        }

        // Render JSON
        if (isJson) {
            const cellContent = (
                <div className={`cursor-pointer ${className}`}>
                    <JsonCellContent value={jsonValue} maxLines={maxLines} truncate />
                </div>
            )

            if (!showPopover) return cellContent

            return (
                <CellContentPopover
                    fullContent={<JsonCellContent value={jsonValue} truncate={false} />}
                    copyText={copyText}
                >
                    {cellContent}
                </CellContentPopover>
            )
        }

        // Render plain text
        const cellContent = (
            <div className={`cursor-pointer ${className}`}>
                <TextCellContent value={displayValue} maxLines={maxLines} truncate />
            </div>
        )

        if (!showPopover) return cellContent

        return (
            <CellContentPopover
                fullContent={<TextCellContent value={displayValue} truncate={false} />}
                copyText={copyText}
            >
                {cellContent}
            </CellContentPopover>
        )
    },
)
SmartCellContent.displayName = "SmartCellContent"

export default SmartCellContent
