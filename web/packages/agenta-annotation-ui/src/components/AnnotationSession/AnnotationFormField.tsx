/**
 * AnnotationFormField
 *
 * Renders the appropriate input component for an annotation metric field
 * based on its schema type (number, boolean, string, array/enum, etc.).
 *
 * Self-contained — no dependency on @/oss.
 */

import {memo, useCallback} from "react"

import {X} from "@phosphor-icons/react"
import {Button, Input, InputNumber, Radio, Select, Slider, Typography} from "antd"

import type {AnnotationMetricField} from "../../hooks/useAnnotationFormState"

// ============================================================================
// TYPES
// ============================================================================

interface AnnotationFormFieldProps {
    /** Field key (used as the label) */
    fieldKey: string
    /** Field definition with value, type, and constraints */
    field: AnnotationMetricField
    /** Whether the field is disabled (prevents interaction, grayed out) */
    disabled?: boolean
    /** Whether the field is read-only (same controls, normal appearance, not interactive) */
    readOnly?: boolean
    /** Called when the field value changes */
    onChange: (value: unknown) => void
}

/**
 * CSS class that overrides Ant Design's disabled styling to look normal.
 * Applied when readOnly is true so the controls appear the same as active ones
 * but don't respond to interaction.
 */
const READONLY_CLASS =
    "[&_.ant-radio-button-wrapper-disabled]:!bg-transparent [&_.ant-radio-button-wrapper-disabled]:!color-inherit [&_.ant-radio-button-wrapper-disabled]:!opacity-100 [&_.ant-radio-button-wrapper-disabled.ant-radio-button-wrapper-checked]:!bg-[var(--ant-color-primary)] [&_.ant-radio-button-wrapper-disabled.ant-radio-button-wrapper-checked]:!text-white [&_.ant-radio-button-wrapper-disabled.ant-radio-button-wrapper-checked]:!border-[var(--ant-color-primary)] [&_.ant-input-disabled]:!bg-transparent [&_.ant-input-disabled]:!color-inherit [&_.ant-input-disabled]:!opacity-100 [&_.ant-input-number-disabled]:!bg-transparent [&_.ant-input-number-disabled]:!opacity-100 [&_.ant-select-disabled]:!opacity-100 [&_.ant-select-disabled_.ant-select-selector]:!bg-transparent [&_.ant-slider-disabled]:!opacity-100 [&_.ant-slider-disabled_.ant-slider-track]:!bg-[var(--ant-color-primary)] [&_.ant-slider-disabled_.ant-slider-handle]::after:!bg-[var(--ant-color-primary)] pointer-events-none"

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const BooleanField = memo(function BooleanField({
    label,
    value,
    disabled,
    readOnly,
    onChange,
}: {
    label: string
    value: boolean | null | undefined
    disabled?: boolean
    readOnly?: boolean
    onChange: (value: boolean | null) => void
}) {
    const hasValue = value !== null && value !== undefined
    const isDisabled = disabled || readOnly

    return (
        <div
            className={`flex flex-col gap-0 playground-property-control ${readOnly ? READONLY_CLASS : ""}`}
        >
            <div className="flex items-center gap-2 justify-between">
                <Typography.Text className="playground-property-control-label">
                    {label}
                </Typography.Text>
                <div className="flex items-center gap-1">
                    <Radio.Group
                        onChange={(e) => onChange(e.target.value)}
                        value={value}
                        disabled={isDisabled}
                    >
                        <Radio.Button value={true}>True</Radio.Button>
                        <Radio.Button value={false}>False</Radio.Button>
                    </Radio.Group>
                    {hasValue && !readOnly && (
                        <Button
                            icon={<X size={14} />}
                            type="text"
                            size="small"
                            onClick={() => onChange(null)}
                            disabled={disabled}
                        />
                    )}
                </div>
            </div>
        </div>
    )
})

const NumberField = memo(function NumberField({
    label,
    value,
    disabled,
    readOnly,
    min,
    max,
    isInteger,
    onChange,
}: {
    label: string
    value: number | null
    disabled?: boolean
    readOnly?: boolean
    min?: number
    max?: number
    isInteger?: boolean
    onChange: (value: number | null) => void
}) {
    const handleChange = useCallback(
        (newValue: number | null) => {
            if (newValue === null) {
                onChange(null)
                return
            }
            onChange(isInteger ? Math.round(newValue) : newValue)
        },
        [onChange, isInteger],
    )

    const displayValue = value !== null && isInteger ? Math.round(value) : value
    const useSlider = min !== undefined && max !== undefined
    const step = isInteger ? 1 : 0.1
    const isDisabled = disabled || readOnly

    return (
        <div
            className={`flex flex-col gap-1 playground-property-control ${readOnly ? READONLY_CLASS : ""}`}
        >
            <div className="flex items-center justify-between">
                <Typography.Text className="playground-property-control-label">
                    {label}
                </Typography.Text>
                {useSlider && (
                    <InputNumber
                        value={displayValue}
                        onChange={handleChange}
                        disabled={isDisabled}
                        min={min}
                        max={max}
                        step={step}
                        precision={isInteger ? 0 : undefined}
                        size="small"
                        className="w-[70px]"
                    />
                )}
            </div>
            {useSlider ? (
                <Slider
                    value={displayValue ?? min ?? 0}
                    onChange={handleChange}
                    disabled={isDisabled}
                    min={min}
                    max={max}
                    step={step}
                    className="!mt-1 !mb-0"
                />
            ) : (
                <InputNumber
                    value={displayValue}
                    onChange={handleChange}
                    disabled={isDisabled}
                    min={min}
                    max={max}
                    step={step}
                    precision={isInteger ? 0 : undefined}
                    className="w-full"
                />
            )}
        </div>
    )
})

const StringField = memo(function StringField({
    label,
    value,
    disabled,
    readOnly,
    onChange,
}: {
    label: string
    value: string | null
    disabled?: boolean
    readOnly?: boolean
    onChange: (value: string | null) => void
}) {
    const isDisabled = disabled || readOnly

    return (
        <div
            className={`flex flex-col gap-1 playground-property-control ${readOnly ? READONLY_CLASS : ""}`}
        >
            <Typography.Text className="playground-property-control-label">{label}</Typography.Text>
            <Input
                value={value ?? ""}
                onChange={(e) => onChange(e.target.value || null)}
                disabled={isDisabled}
                placeholder="Enter value"
            />
        </div>
    )
})

const SelectField = memo(function SelectField({
    label,
    value,
    disabled,
    readOnly,
    options,
    mode,
    onChange,
}: {
    label: string
    value: string | string[] | null
    disabled?: boolean
    readOnly?: boolean
    options: {label: string; value: string}[]
    mode?: "multiple" | "tags"
    onChange: (value: string | string[] | null) => void
}) {
    const handleChange = useCallback(
        (newValue: string | string[]) => {
            if (Array.isArray(newValue) && newValue.length === 0) {
                onChange(null)
            } else {
                onChange(newValue || null)
            }
        },
        [onChange],
    )

    const normalizedValue = (() => {
        if (value === null || value === undefined || value === "") return undefined
        if (Array.isArray(value)) {
            const filtered = value.filter((v) => v !== null && v !== undefined && v !== "")
            return filtered.length === 0 ? undefined : filtered
        }
        if (mode === "multiple" || mode === "tags") return [value]
        return value
    })()

    const isDisabled = disabled || readOnly

    return (
        <div
            className={`flex flex-col gap-1 playground-property-control ${readOnly ? READONLY_CLASS : ""}`}
        >
            <Typography.Text className="playground-property-control-label">{label}</Typography.Text>
            <Select
                value={normalizedValue}
                onChange={handleChange}
                disabled={isDisabled}
                options={options}
                mode={mode}
                placeholder={mode ? "Select options" : "Select"}
                className="w-full"
                allowClear={!readOnly && normalizedValue !== undefined}
            />
        </div>
    )
})

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Renders the appropriate input control based on the metric field's type.
 */
const AnnotationFormField = memo(function AnnotationFormField({
    fieldKey,
    field,
    disabled,
    readOnly,
    onChange,
}: AnnotationFormFieldProps) {
    const type = Array.isArray(field.type) ? field.type[0] : field.type

    // Boolean
    if (type === "boolean") {
        return (
            <BooleanField
                label={fieldKey}
                value={field.value as boolean | null}
                disabled={disabled}
                readOnly={readOnly}
                onChange={onChange as (value: boolean | null) => void}
            />
        )
    }

    // Number / integer
    if (type === "number" || type === "integer" || type === "float") {
        return (
            <NumberField
                label={fieldKey}
                value={field.value as number | null}
                disabled={disabled}
                readOnly={readOnly}
                min={field.minimum}
                max={field.maximum}
                isInteger={type === "integer"}
                onChange={onChange as (value: number | null) => void}
            />
        )
    }

    // Array with enum options (multi-select tags)
    if (type === "array" && field.items?.enum && field.items.enum.length > 0) {
        const options = field.items.enum.map((item) => ({
            label: String(item),
            value: String(item),
        }))
        return (
            <SelectField
                label={fieldKey}
                value={field.value as string[] | null}
                disabled={disabled}
                readOnly={readOnly}
                options={options}
                mode="tags"
                onChange={onChange as (value: string | string[] | null) => void}
            />
        )
    }

    // String/class type with enum options (single select)
    if (Array.isArray(field.type) && field.enum && (field.enum as unknown[]).length > 0) {
        const options = (field.enum as unknown[]).map((item) => ({
            label: item === null ? "none of the above" : String(item),
            value: String(item),
        }))
        return (
            <SelectField
                label={fieldKey}
                value={field.value as string | null}
                disabled={disabled}
                readOnly={readOnly}
                options={options}
                onChange={onChange as (value: string | string[] | null) => void}
            />
        )
    }

    // Default: string input
    return (
        <StringField
            label={fieldKey}
            value={field.value as string | null}
            disabled={disabled}
            readOnly={readOnly}
            onChange={onChange as (value: string | null) => void}
        />
    )
})

export default AnnotationFormField
