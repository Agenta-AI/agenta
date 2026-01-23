/**
 * NumberField
 *
 * Renders a number value as an input number field.
 * This is a pure Ant Design component with no external dependencies.
 */

import {InputNumber} from "antd"

import type {BaseFieldProps} from "./types"

export function NumberField({item, stringValue, fullPath, setValue, valueMode}: BaseFieldProps) {
    const numValue = valueMode === "string" ? JSON.parse(stringValue) : (item.value as number)

    return (
        <InputNumber
            value={numValue}
            onChange={(value) => {
                // Only stringify if editing a top-level column
                const finalValue =
                    valueMode === "string" && fullPath.length === 1
                        ? JSON.stringify(value ?? 0)
                        : (value ?? 0)
                setValue(fullPath, finalValue)
            }}
            className="w-full"
            size="middle"
        />
    )
}
