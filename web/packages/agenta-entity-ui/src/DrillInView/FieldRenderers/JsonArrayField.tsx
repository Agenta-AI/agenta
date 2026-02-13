/**
 * JsonArrayField
 *
 * Renders a JSON array with navigation select and JSON editor.
 */

import {Select} from "antd"

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
                    placeholder="Jump to item"
                    className="w-full"
                    size="small"
                    value={null}
                    options={arrayItems.map((arrItem: unknown, idx: number) => ({
                        value: idx,
                        label: `${idx + 1}. ${getPreview(arrItem)}`,
                    }))}
                    onSelect={(idx: number | null) => {
                        if (idx !== null) {
                            setCurrentPath([...fullPath, String(idx)])
                        }
                    }}
                />
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
