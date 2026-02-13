/**
 * RawModeDisplay
 *
 * Displays field value in raw storage format (read-only).
 * Used when raw mode is toggled on to show the underlying data structure.
 */

import {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"
import type {RawModeDisplayProps} from "./types"

export function RawModeDisplay({
    item,
    stringValue,
    dataType,
    fullPath,
    valueMode,
}: RawModeDisplayProps) {
    const originalWasString = typeof item.value === "string"

    // For nested objects/arrays (not originally strings), use JSON editor (read-only)
    if (
        !originalWasString &&
        (dataType === "json-object" || dataType === "json-array" || dataType === "messages")
    ) {
        return (
            <JsonEditorWithLocalState
                editorKey={`${fullPath.join("-")}-raw-editor`}
                initialValue={stringValue}
                onValidChange={() => {}}
                readOnly
            />
        )
    }

    // Calculate raw display value
    let rawValue = stringValue

    if (
        originalWasString &&
        (dataType === "json-object" || dataType === "json-array" || dataType === "messages")
    ) {
        // String-encoded JSON: show as escaped string literal
        try {
            const parsed = JSON.parse(stringValue)
            const compactJson = JSON.stringify(parsed)
            rawValue = JSON.stringify(compactJson)
        } catch {
            // If parsing fails, use stringValue as-is
        }
    } else if (dataType === "string") {
        if (valueMode === "string") {
            // Part of stringified JSON structure: show double-escaped
            const withQuotes = JSON.stringify(stringValue)
            rawValue = JSON.stringify(withQuotes)
        } else {
            // Native mode: just show with quotes
            rawValue = JSON.stringify(stringValue)
        }
    }
    // Numbers and booleans stay as-is (no escaping needed)

    return (
        <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 text-[#9d4edd] p-3 bg-gray-50 rounded-md max-h-[400px] overflow-auto">
            {rawValue}
        </pre>
    )
}
