import {memo, useMemo} from "react"

import {Typography} from "antd"

import {truncateContent} from "./utils"

const {Text} = Typography

interface TextCellContentProps {
    /** Text value to render */
    value: string
    /** Max lines to show when truncated */
    maxLines?: number
    /** Max characters to show when truncated */
    maxChars?: number
    /** Whether to truncate content (default: true for cell, false for popover) */
    truncate?: boolean
    /** Additional CSS class */
    className?: string
}

/**
 * Renders plain text content with truncation support.
 *
 * Optimizations:
 * - Truncation for cell preview
 * - Memoized truncation
 */
const TextCellContent = memo(
    ({value, maxLines = 10, maxChars = 500, truncate = true, className}: TextCellContentProps) => {
        const displayValue = useMemo(() => {
            if (!truncate) return value
            return truncateContent(value, maxLines, maxChars)
        }, [value, truncate, maxLines, maxChars])

        return (
            <Text className={`text-xs whitespace-pre-wrap ${className ?? ""}`}>{displayValue}</Text>
        )
    },
)
TextCellContent.displayName = "TextCellContent"

export default TextCellContent
