import {memo, useMemo} from "react"

import {Typography} from "antd"

import {
    CellContentPopover,
    JsonCellContent,
    TextCellContent,
    normalizeValue,
    safeJsonStringify,
    tryParseJson,
} from "@/oss/components/CellRenderers"

const {Text} = Typography

interface TestcaseCellContentProps {
    value: unknown
    /** Max lines to show in cell preview (default: 10) */
    maxLines?: number
}

/**
 * Smart cell content renderer that handles JSON and plain text appropriately
 * - Detects JSON objects/arrays and renders with syntax highlighting
 * - Shows full content in popover on hover
 * - Handles plain text with proper truncation
 * - Uses testcase-table-cell class for row height constraints
 *
 * Uses shared CellRenderers components for consistency across tables.
 */
const TestcaseCellContent = memo(({value, maxLines = 10}: TestcaseCellContentProps) => {
    const {parsed: jsonValue, isJson} = useMemo(() => tryParseJson(value), [value])
    const displayValue = useMemo(() => normalizeValue(value), [value])

    // Generate copy text for popover
    const copyText = useMemo(() => {
        if (value === undefined || value === null || value === "") {
            return undefined
        }
        if (isJson) {
            return safeJsonStringify(jsonValue)
        }
        return displayValue
    }, [value, isJson, jsonValue, displayValue])

    // Memoize popover content to prevent re-creating elements on every render
    // This prevents the "Maximum update depth exceeded" error during scroll
    const fullContent = useMemo(() => {
        if (isJson) {
            return <JsonCellContent value={jsonValue} truncate={false} />
        }
        return <TextCellContent value={displayValue} truncate={false} />
    }, [isJson, jsonValue, displayValue])

    // Memoize preview content to prevent re-creating on every render
    const previewContent = useMemo(() => {
        if (isJson) {
            return <JsonCellContent value={jsonValue} maxLines={maxLines} />
        }
        return <TextCellContent value={displayValue} maxLines={maxLines} />
    }, [isJson, jsonValue, displayValue, maxLines])

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
