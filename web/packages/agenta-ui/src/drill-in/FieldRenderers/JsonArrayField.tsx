/**
 * JsonArrayField
 *
 * Renders a JSON array with navigation select and JSON editor.
 */

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"

import {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"
import type {JsonArrayFieldProps} from "./types"

export function JsonArrayField({
    item,
    stringValue,
    fullPath,
    setValue,
    valueMode,
    setCurrentPath,
}: JsonArrayFieldProps) {
    const arrayItems = JSON.parse(stringValue) as unknown[]
    const originalWasString = typeof item.value === "string"

    const getPreview = (arrItem: unknown) =>
        typeof arrItem === "string"
            ? arrItem.length > 60
                ? arrItem.substring(0, 60) + "..."
                : arrItem
            : typeof arrItem === "object" && arrItem !== null
              ? JSON.stringify(arrItem).substring(0, 60) + "..."
              : String(arrItem)

    return (
        <div className="flex flex-col gap-2">
            {/* Navigation select for drilling into items */}
            {arrayItems.length > 0 && (
                <Select
                    value={undefined}
                    onValueChange={(val) => setCurrentPath([...fullPath, val])}
                >
                    <SelectTrigger className="w-full" size="sm">
                        <SelectValue placeholder="Jump to item" />
                    </SelectTrigger>
                    <SelectContent>
                        {arrayItems.map((arrItem: unknown, idx: number) => (
                            <SelectItem key={idx} value={String(idx)}>
                                {idx + 1}. {getPreview(arrItem)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}

            {/* Editable JSON editor for array content */}
            <JsonEditorWithLocalState
                editorKey={`${fullPath.join("-")}-editor`}
                initialValue={stringValue}
                onValidChange={(value) => {
                    const shouldStringify = valueMode === "string" || originalWasString
                    if (shouldStringify) {
                        setValue(fullPath, value)
                    } else {
                        setValue(fullPath, JSON.parse(value))
                    }
                }}
                onPropertyClick={(clickedPath) => {
                    const pathParts = clickedPath.split(".")
                    setCurrentPath([...fullPath, ...pathParts])
                }}
            />

            {arrayItems.length === 0 && <div className="text-sm text-gray-400">Empty array</div>}
        </div>
    )
}
