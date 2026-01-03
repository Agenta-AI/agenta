import {memo, useMemo} from "react"

import {JSON_HIGHLIGHT_COLOR} from "./constants"
import {safeJsonStringify, truncateContent} from "./utils"

interface JsonCellContentProps {
    /** JSON value to render */
    value: unknown
    /** Max lines to show when truncated */
    maxLines?: number
    /** Max characters to show when truncated */
    maxChars?: number
    /** Whether to truncate content (default: true for cell, false for popover) */
    truncate?: boolean
}

/**
 * Renders JSON content as plain formatted text with syntax highlighting color.
 * Uses plain <pre> tags instead of heavy editor components for performance.
 *
 * Optimizations:
 * - No Lexical/CodeMirror editor overhead
 * - Truncation for cell preview
 * - Memoized JSON stringification
 */
const JsonCellContent = memo(
    ({value, maxLines = 10, maxChars = 500, truncate = true}: JsonCellContentProps) => {
        const jsonString = useMemo(() => {
            const full = safeJsonStringify(value)
            if (!truncate) return full
            return truncateContent(full, maxLines, maxChars)
        }, [value, truncate, maxLines, maxChars])

        return (
            <pre
                className="text-xs font-mono whitespace-pre-wrap break-words m-0 overflow-hidden"
                style={{color: JSON_HIGHLIGHT_COLOR}}
            >
                {jsonString}
            </pre>
        )
    },
)
JsonCellContent.displayName = "JsonCellContent"

export default JsonCellContent
