/**
 * BooleanField
 *
 * Renders a boolean value as a toggle switch.
 * This is a pure Ant Design component with no external dependencies.
 */

import {Switch} from "antd"

import type {BaseFieldProps} from "./types"

export function BooleanField({item, stringValue, fullPath, setValue, valueMode}: BaseFieldProps) {
    const boolValue =
        valueMode === "string" ? JSON.parse(stringValue) === true : item.value === true

    return (
        <div className="flex items-center gap-3 py-2">
            <Switch
                checked={boolValue}
                onChange={(checked) => {
                    // Only stringify if editing a top-level column
                    const value =
                        valueMode === "string" && fullPath.length === 1
                            ? JSON.stringify(checked)
                            : checked
                    setValue(fullPath, value)
                }}
            />
            <span className="text-sm text-gray-600">{boolValue ? "true" : "false"}</span>
        </div>
    )
}
