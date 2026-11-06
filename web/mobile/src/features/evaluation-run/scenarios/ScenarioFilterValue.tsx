import {useState} from "react"

import {
    filterValueFromText,
    filterValueToText,
    isListOperator,
    type FilterOperator,
    type FilterValueType,
} from "@agenta/entities/evaluationRun/etl"
import {Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"

/**
 * The value of a filter condition. A flag is a true or false pick; a list operator takes values
 * split by commas; a number column takes a number. The typed text stays as typed while the value
 * is read from it.
 */
export const ScenarioFilterValue = ({
    op,
    valueType,
    value,
    disabled,
    onChange,
}: {
    op: FilterOperator
    valueType: FilterValueType
    value: unknown
    disabled: boolean
    onChange: (value: unknown) => void
}) => {
    const [text, setText] = useState(() => filterValueToText(value))
    const list = isListOperator(op)

    if (valueType === "boolean" && !list) {
        return (
            <Select
                value={value === true ? "true" : value === false ? "false" : undefined}
                disabled={disabled}
                onValueChange={(next) => onChange(next === "true")}
            >
                <SelectTrigger size="sm" aria-label="Value" className="min-w-0 flex-1">
                    <SelectValue placeholder="Value" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="true">true</SelectItem>
                    <SelectItem value="false">false</SelectItem>
                </SelectContent>
            </Select>
        )
    }

    return (
        <Input
            aria-label="Value"
            className="min-w-0 flex-1"
            inputMode={valueType === "number" && !list ? "decimal" : undefined}
            placeholder={list ? "Values, separated by commas" : "Value"}
            disabled={disabled}
            value={text}
            onChange={(event) => {
                setText(event.target.value)
                onChange(filterValueFromText(event.target.value, valueType, op))
            }}
        />
    )
}
