import {memo, useId, useMemo} from "react"

import {
    CellContentPopover,
    ChatMessagesCellContent,
    JsonCellContent,
    TextCellContent,
    extractChatMessages,
    normalizeValue,
    safeJsonStringify,
    type ChatPreviewStrategy,
} from "@agenta/ui/cell-renderers"
import {Typography} from "antd"

import {parseTestcaseCellJson} from "./testcaseCellValueUtils"

const {Text} = Typography
const LAST_USER_PREVIEW_COLUMNS = new Set(["messages", "prompt", "input_messages"])

interface TestcaseCellContentProps {
    value: unknown
    /** Column key/path, used for testcase-specific chat preview decisions */
    columnKey?: string
    /** Max lines to show in cell preview (default: 10) */
    maxLines?: number
}

export function getTestcaseChatPreviewStrategy(
    columnKey?: string,
): ChatPreviewStrategy | undefined {
    const leafKey = columnKey?.split(".").pop()?.toLowerCase()
    return leafKey && LAST_USER_PREVIEW_COLUMNS.has(leafKey) ? "last-user" : undefined
}

/**
 * Smart cell content renderer that handles chat messages, JSON, and plain text appropriately
 * - Detects chat messages (single or array) and renders with ChatMessagesCellContent
 * - Detects JSON objects/arrays and renders with syntax highlighting
 * - Shows full content in popover on hover
 * - Handles plain text with proper truncation
 * - Uses testcase-table-cell class for row height constraints
 *
 * Uses shared CellRenderers components for consistency across tables.
 */
const TestcaseCellContent = memo(({value, columnKey, maxLines = 10}: TestcaseCellContentProps) => {
    const keyPrefix = useId()
    const {parsed: jsonValue, isJson} = useMemo(() => parseTestcaseCellJson(value), [value])
    const displayValue = useMemo(() => normalizeValue(value), [value])
    const chatPreviewStrategy = useMemo(
        () => getTestcaseChatPreviewStrategy(columnKey),
        [columnKey],
    )

    // Check for chat messages (single message or array)
    const chatMessages = useMemo(() => extractChatMessages(jsonValue), [jsonValue])
    const isChatMessages = chatMessages !== null && chatMessages.length > 0

    // Generate copy text for popover
    const copyText = useMemo(() => {
        if (value === undefined || value === null || value === "") {
            return undefined
        }
        if (isChatMessages || isJson) {
            return safeJsonStringify(jsonValue)
        }
        return displayValue
    }, [value, isChatMessages, isJson, jsonValue, displayValue])

    // Memoize popover content to prevent re-creating elements on every render
    // This prevents the "Maximum update depth exceeded" error during scroll
    const fullContent = useMemo(() => {
        if (isChatMessages) {
            return (
                <ChatMessagesCellContent
                    value={jsonValue}
                    keyPrefix={`${keyPrefix}-popover`}
                    truncate={false}
                />
            )
        }
        if (isJson) {
            return <JsonCellContent value={jsonValue} truncate={false} />
        }
        return <TextCellContent value={displayValue} truncate={false} />
    }, [isChatMessages, isJson, jsonValue, displayValue, value, keyPrefix])

    // Memoize preview content to prevent re-creating on every render
    const previewContent = useMemo(() => {
        if (isChatMessages) {
            return (
                <ChatMessagesCellContent
                    value={jsonValue}
                    keyPrefix={keyPrefix}
                    previewStrategy={chatPreviewStrategy}
                    maxLines={4}
                    maxTotalLines={maxLines}
                    truncate
                />
            )
        }
        if (isJson) {
            return <JsonCellContent value={jsonValue} maxLines={maxLines} />
        }
        return <TextCellContent value={displayValue} maxLines={maxLines} />
    }, [
        isChatMessages,
        isJson,
        jsonValue,
        displayValue,
        maxLines,
        value,
        keyPrefix,
        chatPreviewStrategy,
    ])

    // Handle empty values (null, undefined, empty string) - render placeholder
    // The testcase-table-cell class ensures proper height from CSS variables
    if (value === undefined || value === null || value === "") {
        return (
            <div className="testcase-table-cell">
                <Text type="secondary" className="text-xs">
                    —
                </Text>
            </div>
        )
    }

    // Render with popover
    return (
        <CellContentPopover fullContent={fullContent} copyText={copyText}>
            <div className="testcase-table-cell cursor-pointer">{previewContent}</div>
        </CellContentPopover>
    )
})
TestcaseCellContent.displayName = "TestcaseCellContent"

export default TestcaseCellContent
