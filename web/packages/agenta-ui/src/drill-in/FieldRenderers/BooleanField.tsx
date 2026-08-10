/**
 * BooleanField
 *
 * Renders a boolean value as a toggle switch.
 */

import {Switch} from "../../components/ui/switch"

import type {BaseFieldProps} from "./types"

export function BooleanField({item, stringValue, fullPath, setValue, valueMode}: BaseFieldProps) {
    const boolValue =
        valueMode === "string" ? JSON.parse(stringValue) === true : item.value === true

    return (
        <div className="flex items-center gap-3 py-2">
            <Switch
                checked={boolValue}
                onCheckedChange={(checked) => {
                    // Only stringify if editing a top-level column
                    const value =
                        valueMode === "string" && fullPath.length === 1
                            ? JSON.stringify(checked)
                            : checked
                    setValue(fullPath, value)
                }}
            />
            <span className="text-xs text-colorTextSecondary">{boolValue ? "true" : "false"}</span>
        </div>
    )
}
