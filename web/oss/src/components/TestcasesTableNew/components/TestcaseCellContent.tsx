import {memo, useCallback, useMemo} from "react"

import {Copy} from "@phosphor-icons/react"
import {Button, Popover, Typography} from "antd"
import dynamic from "next/dynamic"

import {message} from "../../AppMessageContext"

const JsonEditor = dynamic(() => import("@/oss/components/Editor/Editor"), {ssr: false})

const {Text} = Typography

/**
 * Try to parse a JSON string, returns the parsed value or null if not valid JSON
 */
const tryParseJson = (value: unknown): {parsed: unknown; isJson: boolean} => {
    if (value === null || value === undefined) {
        return {parsed: value, isJson: false}
    }
    // Already an object/array
    if (typeof value === "object") {
        return {parsed: value, isJson: true}
    }
    // Try to parse string as JSON
    if (typeof value === "string") {
        const trimmed = value.trim()
        if (
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
            try {
                const parsed = JSON.parse(trimmed)
                return {parsed, isJson: true}
            } catch {
                return {parsed: value, isJson: false}
            }
        }
    }
    return {parsed: value, isJson: false}
}

/**
 * Safely stringify a value to JSON
 */
const safeJsonStringify = (value: unknown): string => {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/**
 * Normalize value to display string
 */
const normalizeValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    return safeJsonStringify(value)
}

// Performance test flag - set to true to use plain text instead of editors
const USE_PLAIN_TEXT_RENDER = true

// Default max lines for different row heights
// Small (80px): ~4 lines, Medium (160px): ~10 lines, Large (280px): ~18 lines
const DEFAULT_MAX_LINES = 10

/**
 * Truncate string to first N lines for cell preview
 */
const truncateToLines = (str: string, maxLines: number): string => {
    const lines = str.split("\n")
    if (lines.length <= maxLines) return str
    return lines.slice(0, maxLines).join("\n") + "\n..."
}

/**
 * Truncate string to max characters for cell preview
 * This is critical for performance - prevents rendering huge text blocks
 */
const MAX_CELL_CHARS = 500
const truncateToChars = (str: string, maxChars: number = MAX_CELL_CHARS): string => {
    if (str.length <= maxChars) return str
    return str.slice(0, maxChars) + "..."
}

/**
 * Render JSON content as plain formatted text (performance mode)
 * Only renders first few lines to reduce DOM size when truncate=true
 */
const JsonContentPlain = memo(
    ({
        value,
        truncate = true,
        maxLines = DEFAULT_MAX_LINES,
    }: {
        value: unknown
        truncate?: boolean
        maxLines?: number
    }) => {
        const jsonString = useMemo(() => {
            const full = safeJsonStringify(value)
            return truncate ? truncateToLines(full, maxLines) : full
        }, [value, truncate, maxLines])
        return (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 overflow-hidden text-[#9d4edd]">
                {jsonString}
            </pre>
        )
    },
)
JsonContentPlain.displayName = "JsonContentPlain"

/**
 * Render JSON content using the code editor
 */
const JsonContentEditor = memo(({value, height}: {value: unknown; height?: number}) => {
    const jsonString = useMemo(() => safeJsonStringify(value), [value])
    return (
        <div className="overflow-hidden [&_.editor-inner]:!border-0 [&_.editor-inner]:!bg-transparent [&_.editor-container]:!bg-transparent [&_.editor-code]:!bg-transparent [&_.editor-code]:!text-xs">
            <JsonEditor
                initialValue={jsonString}
                language="json"
                codeOnly
                showToolbar={false}
                disabled
                enableResize={false}
                boundWidth
                showLineNumbers={false}
                dimensions={{width: "100%", height: height ?? "auto"}}
            />
        </div>
    )
})
JsonContentEditor.displayName = "JsonContentEditor"

/**
 * Render JSON content - switches between plain text and editor based on flag
 * @param truncate - if true, only show first few lines (for cell preview)
 * @param maxLines - max lines to show when truncated
 */
const JsonContent = memo(
    ({
        value,
        height,
        truncate = true,
        maxLines,
    }: {
        value: unknown
        height?: number
        truncate?: boolean
        maxLines?: number
    }) => {
        if (USE_PLAIN_TEXT_RENDER) {
            return <JsonContentPlain value={value} truncate={truncate} maxLines={maxLines} />
        }
        return <JsonContentEditor value={value} height={height} />
    },
)
JsonContent.displayName = "JsonContent"

/**
 * Popover content component - only rendered when popover is open
 */
const PopoverContent = memo(
    ({fullContent, isJson}: {fullContent: React.ReactNode; isJson: boolean}) => {
        const handleCopy = useCallback(() => {
            const textToCopy = typeof fullContent === "string" ? fullContent : String(fullContent)
            navigator.clipboard.writeText(textToCopy)
            message.success("Copied to clipboard")
        }, [fullContent])

        return (
            <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end">
                    <Button type="text" size="small" icon={<Copy size={14} />} onClick={handleCopy}>
                        Copy
                    </Button>
                </div>
                <div className="max-h-[350px] overflow-auto">
                    {isJson ? (
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 text-[#9d4edd]">
                            {fullContent}
                        </pre>
                    ) : (
                        <Text className="text-xs whitespace-pre-wrap">{fullContent}</Text>
                    )}
                </div>
            </div>
        )
    },
)
PopoverContent.displayName = "PopoverContent"

/**
 * Popover wrapper for cell content
 * Uses uncontrolled mode to avoid state updates during scroll
 */
const CellContentPopover = memo(
    ({
        children,
        fullContent,
        isJson,
    }: {
        children: React.ReactNode
        fullContent: React.ReactNode
        isJson: boolean
    }) => {
        return (
            <Popover
                trigger="hover"
                mouseEnterDelay={0.5}
                mouseLeaveDelay={0.2}
                destroyOnHidden
                overlayClassName="testcase-cell-popover"
                overlayStyle={{maxWidth: 500, maxHeight: 400}}
                content={<PopoverContent fullContent={fullContent} isJson={isJson} />}
            >
                {children}
            </Popover>
        )
    },
)
CellContentPopover.displayName = "CellContentPopover"

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
 */
const TestcaseCellContent = memo(({value, maxLines}: TestcaseCellContentProps) => {
    const {parsed: jsonValue, isJson} = useMemo(() => tryParseJson(value), [value])
    const displayValue = useMemo(() => normalizeValue(value), [value])

    // Generate full content for popover
    // Must be before early return to satisfy React hooks rules
    const fullContent = useMemo(() => {
        if (value === undefined || value === null || value === "") {
            return undefined
        }
        if (isJson) {
            return safeJsonStringify(jsonValue)
        }
        return displayValue
    }, [value, isJson, jsonValue, displayValue])

    // Plain text - truncate to prevent rendering huge text blocks
    // This is critical for scroll performance - must be before early returns
    const truncatedDisplayValue = useMemo(() => {
        if (value === undefined || value === null || value === "" || isJson) {
            return ""
        }
        // Apply both line and character truncation for plain text
        const linesTruncated = truncateToLines(displayValue, maxLines ?? DEFAULT_MAX_LINES)
        return truncateToChars(linesTruncated)
    }, [value, displayValue, maxLines, isJson])

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

    // Render JSON objects/arrays
    if (isJson) {
        return (
            <CellContentPopover fullContent={fullContent} isJson={isJson}>
                <div className="testcase-table-cell cursor-pointer">
                    <JsonContent value={jsonValue} maxLines={maxLines} />
                </div>
            </CellContentPopover>
        )
    }

    // Plain text with truncation
    return (
        <CellContentPopover fullContent={fullContent} isJson={isJson}>
            <div className="testcase-table-cell cursor-pointer">
                <Text className="text-xs whitespace-pre-wrap">{truncatedDisplayValue}</Text>
            </div>
        </CellContentPopover>
    )
})
TestcaseCellContent.displayName = "TestcaseCellContent"

export default TestcaseCellContent
