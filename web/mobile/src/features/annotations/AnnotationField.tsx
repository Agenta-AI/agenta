import {useId} from "react"

import type {AnnotationMetricField} from "@agenta/annotation"
import {
    AutosizeTextarea,
    Segmented,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"

import {AnnotationFieldLabel} from "./AnnotationFieldLabel"
import {AnnotationMultiSelect} from "./AnnotationMultiSelect"
import {AnnotationNumberField} from "./AnnotationNumberField"

const BOOLEAN_OPTIONS = [
    {value: "true", label: "True"},
    {value: "false", label: "False"},
]
/** A value no option has, so the segmented control shows no choice instead of picking the first. */
const NO_CHOICE = ""

const isEmpty = (value: unknown) =>
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)

/**
 * One metric of an evaluator, drawn by its schema type: True and False, a number (with a slider
 * when the range is known), a multi or single select over the schema's values, or free text.
 * Read only keeps the same look; the controls just stop taking input.
 */
export const AnnotationField = ({
    fieldKey,
    field,
    readOnly = false,
    onChange,
}: {
    fieldKey: string
    field: AnnotationMetricField
    readOnly?: boolean
    onChange: (value: unknown) => void
}) => {
    const id = useId()
    const type = Array.isArray(field.type) ? field.type[0] : field.type
    const value = field.value
    const canClear = !readOnly && !isEmpty(value)
    const clear = () => onChange(null)

    if (type === "boolean") {
        return (
            <AnnotationFieldLabel
                label={fieldKey}
                canClear={canClear}
                onClear={clear}
                trailing={
                    <div inert={readOnly}>
                        <Segmented
                            size="sm"
                            aria-label={fieldKey}
                            options={BOOLEAN_OPTIONS}
                            value={typeof value === "boolean" ? String(value) : NO_CHOICE}
                            onChange={(next) => onChange(next === "true")}
                        />
                    </div>
                }
            />
        )
    }

    if (type === "number" || type === "integer" || type === "float") {
        return (
            <AnnotationNumberField
                label={fieldKey}
                value={typeof value === "number" ? value : null}
                min={field.minimum}
                max={field.maximum}
                isInteger={type === "integer"}
                readOnly={readOnly}
                onChange={onChange}
            />
        )
    }

    const itemOptions = field.items?.enum
    if (type === "array" && itemOptions && itemOptions.length > 0) {
        const selected = (Array.isArray(value) ? value : isEmpty(value) ? [] : [value]).map(String)
        return (
            <div className="flex flex-col gap-1.5">
                <AnnotationFieldLabel
                    label={fieldKey}
                    htmlFor={id}
                    canClear={canClear}
                    onClear={clear}
                />
                <div inert={readOnly}>
                    <AnnotationMultiSelect
                        id={id}
                        options={itemOptions.map(String)}
                        value={selected}
                        onChange={onChange}
                    />
                </div>
            </div>
        )
    }

    if (Array.isArray(field.type) && field.enum && field.enum.length > 0) {
        return (
            <div className="flex flex-col gap-1.5">
                <AnnotationFieldLabel
                    label={fieldKey}
                    htmlFor={id}
                    canClear={canClear}
                    onClear={clear}
                />
                <div inert={readOnly}>
                    <Select value={isEmpty(value) ? "" : String(value)} onValueChange={onChange}>
                        <SelectTrigger id={id} className="w-full">
                            <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                            {field.enum.map((option) => (
                                <SelectItem key={String(option)} value={String(option)}>
                                    {option === null ? "none of the above" : String(option)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-1.5">
            <AnnotationFieldLabel
                label={fieldKey}
                htmlFor={id}
                canClear={canClear}
                onClear={clear}
            />
            <AutosizeTextarea
                id={id}
                autoSize={{minRows: 2, maxRows: 6}}
                placeholder="Enter a value"
                value={typeof value === "string" ? value : isEmpty(value) ? "" : String(value)}
                readOnly={readOnly}
                onChange={(event) => onChange(event.target.value || null)}
            />
        </div>
    )
}
