import {memo, useMemo} from "react"

import {JSON_HIGHLIGHT_CLASS} from "./constants"
import {getBeautifiedJsonEntries, safeJsonStringify, truncateContent} from "./utils"

interface JsonCellContentProps {
    /** JSON value to render */
    value: unknown
    /** Max lines to show when truncated */
    maxLines?: number
    /** Max characters to show when truncated */
    maxChars?: number
    /** Whether to truncate content (default: true for cell, false for popover) */
    truncate?: boolean
    /** Render records as compact key/value fields instead of raw JSON text */
    beautified?: boolean
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
    ({
        value,
        maxLines = 10,
        maxChars = 500,
        truncate = true,
        beautified = false,
    }: JsonCellContentProps) => {
        const beautifiedEntries = useMemo(
            () => (beautified ? getBeautifiedJsonEntries(value) : null),
            [beautified, value],
        )
        const displayString = useMemo(() => {
            const full = safeJsonStringify(value)
            if (!truncate) return full
            return truncateContent(full, maxLines, maxChars)
        }, [value, truncate, maxLines, maxChars])

        if (beautifiedEntries) {
            const visibleEntries = truncate
                ? beautifiedEntries.slice(0, Math.max(maxLines, 1))
                : beautifiedEntries

            return (
                <div className="flex flex-col gap-1 text-xs">
                    {visibleEntries.map((entry) => (
                        <div key={entry.key} className="flex flex-col gap-0.5">
                            <span className="font-medium text-blue-6">{entry.key}</span>
                            <span className="whitespace-pre-wrap break-words">{entry.value}</span>
                        </div>
                    ))}
                    {truncate && beautifiedEntries.length > visibleEntries.length && (
                        <span className="italic">
                            +{beautifiedEntries.length - visibleEntries.length} more field
                            {beautifiedEntries.length - visibleEntries.length > 1 ? "s" : ""}
                        </span>
                    )}
                </div>
            )
        }

        return (
            <pre
                className={`text-xs font-mono whitespace-pre-wrap break-words m-0 overflow-hidden ${JSON_HIGHLIGHT_CLASS}`}
            >
                {displayString}
            </pre>
        )
    },
)
JsonCellContent.displayName = "JsonCellContent"

export default JsonCellContent
