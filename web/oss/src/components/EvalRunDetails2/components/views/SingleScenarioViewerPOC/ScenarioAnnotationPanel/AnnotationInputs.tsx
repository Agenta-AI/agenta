import {memo, useCallback} from "react"

import {X} from "@phosphor-icons/react"
import {Button, Input, InputNumber, Radio, Select, Slider, Tooltip, Typography} from "antd"

/**
 * Annotation input components that call onChange immediately (no debounce).
 * This prevents stale updates when navigating between scenarios.
 */

interface BooleanGroupTabProps {
    label: string
    value: boolean | string | null | undefined
    onChange: (value: boolean | string | null) => void
    disabled?: boolean
    options?: {label: string; value: boolean | string}[]
    description?: string
    allowClear?: boolean
    disableClear?: boolean
}

/**
 * Boolean input rendered as radio button group (True/False)
 * Options can have boolean or string values - we preserve the type as-is
 */
export const BooleanGroupTab = memo(function BooleanGroupTab({
    label,
    value,
    onChange,
    disabled,
    options,
    description,
    allowClear = false,
    disableClear = false,
}: BooleanGroupTabProps) {
    const handleChange = useCallback(
        (newValue: boolean | string | null) => {
            onChange(newValue)
        },
        [onChange],
    )

    // Check if value is set (not null/undefined)
    const hasValue = value !== null && value !== undefined

    return (
        <div className="flex flex-col gap-0 mb-0 playground-property-control">
            <Tooltip title={description || ""} placement="right">
                <div className="flex items-center gap-2 justify-between">
                    <Typography.Text className="playground-property-control-label">
                        {label}
                    </Typography.Text>

                    <div className="flex items-center gap-1">
                        <Radio.Group
                            onChange={(e) => handleChange(e.target.value)}
                            value={value}
                            disabled={disabled}
                        >
                            {options?.map((option) => (
                                <Radio.Button key={String(option.value)} value={option.value}>
                                    {option.label}
                                </Radio.Button>
                            ))}
                        </Radio.Group>

                        {hasValue || allowClear ? (
                            <Button
                                icon={<X size={14} />}
                                type="text"
                                size="small"
                                onClick={() => handleChange(null)}
                                disabled={disabled || disableClear}
                            />
                        ) : null}
                    </div>
                </div>
            </Tooltip>
        </div>
    )
})

interface StringInputProps {
    label: string
    value: string | null
    onChange: (value: string | null) => void
    disabled?: boolean
    placeholder?: string
    description?: string
    multiline?: boolean
}

/**
 * String input (text input or textarea)
 */
export const StringInput = memo(function StringInput({
    label,
    value,
    onChange,
    disabled,
    placeholder,
    description,
    multiline = false,
}: StringInputProps) {
    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            onChange(e.target.value || null)
        },
        [onChange],
    )

    return (
        <div className="flex flex-col gap-1 playground-property-control">
            <Tooltip title={description || ""} placement="right">
                <Typography.Text className="playground-property-control-label">
                    {label}
                </Typography.Text>
            </Tooltip>
            {multiline ? (
                <Input.TextArea
                    value={value ?? ""}
                    onChange={handleChange}
                    disabled={disabled}
                    placeholder={placeholder}
                    autoSize={{minRows: 2, maxRows: 6}}
                />
            ) : (
                <Input
                    value={value ?? ""}
                    onChange={handleChange}
                    disabled={disabled}
                    placeholder={placeholder}
                />
            )}
        </div>
    )
})

interface NumberInputProps {
    label: string
    value: number | null
    onChange: (value: number | null) => void
    disabled?: boolean
    min?: number
    max?: number
    step?: number
    description?: string
    useSlider?: boolean
}

/**
 * Number input (input number or slider)
 */
export const NumberInput = memo(function NumberInput({
    label,
    value,
    onChange,
    disabled,
    min,
    max,
    step = 1,
    description,
    useSlider = false,
}: NumberInputProps) {
    const handleChange = useCallback(
        (newValue: number | null) => {
            onChange(newValue)
        },
        [onChange],
    )

    return (
        <div className="flex flex-col gap-1 playground-property-control">
            <Tooltip title={description || ""} placement="right">
                <div className="flex items-center justify-between">
                    <Typography.Text className="playground-property-control-label">
                        {label}
                    </Typography.Text>
                    {useSlider && (
                        <InputNumber
                            value={value}
                            onChange={handleChange}
                            disabled={disabled}
                            min={min}
                            max={max}
                            step={step}
                            size="small"
                            className="w-[70px]"
                        />
                    )}
                </div>
            </Tooltip>
            {useSlider ? (
                <Slider
                    value={value ?? min ?? 0}
                    onChange={handleChange}
                    disabled={disabled}
                    min={min}
                    max={max}
                    step={step}
                    className="!mt-1 !mb-0"
                />
            ) : (
                <InputNumber
                    value={value}
                    onChange={handleChange}
                    disabled={disabled}
                    min={min}
                    max={max}
                    step={step}
                    className="w-full"
                />
            )}
        </div>
    )
})

interface SelectInputProps {
    label: string
    value: string | string[] | null
    onChange: (value: string | string[] | null) => void
    disabled?: boolean
    options?: {label: string; value: string}[]
    description?: string
    mode?: "multiple" | "tags"
    placeholder?: string
}

/**
 * Select/dropdown input
 */
export const SelectInput = memo(function SelectInput({
    label,
    value,
    onChange,
    disabled,
    options,
    description,
    mode,
    placeholder,
}: SelectInputProps) {
    const handleChange = useCallback(
        (newValue: string | string[]) => {
            // Normalize empty arrays to null
            if (Array.isArray(newValue) && newValue.length === 0) {
                onChange(null)
            } else {
                onChange(newValue || null)
            }
        },
        [onChange],
    )

    // Normalize value for Select component
    // When mode is multiple/tags, value must be an array or undefined
    const normalizedValue = (() => {
        // Handle empty/null/undefined cases
        if (value === null || value === undefined || value === "") {
            return undefined
        }
        if (Array.isArray(value)) {
            // Filter out empty/null/undefined values from array
            const filtered = value.filter((v) => v !== null && v !== undefined && v !== "")
            return filtered.length === 0 ? undefined : filtered
        }
        // For multiple/tags mode, wrap single value in array
        if (mode === "multiple" || mode === "tags") {
            return [value]
        }
        return value
    })()

    return (
        <div className="flex flex-col gap-1 playground-property-control">
            <Tooltip title={description || ""} placement="right">
                <Typography.Text className="playground-property-control-label">
                    {label}
                </Typography.Text>
            </Tooltip>
            <Select
                value={normalizedValue}
                onChange={handleChange}
                disabled={disabled}
                options={options}
                mode={mode}
                placeholder={placeholder ?? (mode ? "Select options" : "Select")}
                className="w-full"
                allowClear={normalizedValue !== undefined}
            />
        </div>
    )
})

// Metadata type from the transform
interface AnnotationMetadata {
    title: string
    type: string
    value: unknown
    description?: string
    options?: {label: string; value: string}[]
    minimum?: number
    maximum?: number
    step?: number
    as?: string
    disabled?: boolean
    placeholder?: string
    mode?: "multiple" | "tags"
    allowClear?: boolean
    disableClear?: boolean
}

interface AnnotationFieldRendererProps {
    metadata: AnnotationMetadata
    annSlug: string
    onChange: (annSlug: string, fieldKey: string, value: unknown) => void
}

/**
 * Renders the appropriate input component based on metadata type
 */
export const AnnotationFieldRenderer = memo(function AnnotationFieldRenderer({
    metadata,
    annSlug,
    onChange,
}: AnnotationFieldRendererProps) {
    const handleChange = useCallback(
        (value: unknown) => {
            onChange(annSlug, metadata.title, value)
        },
        [onChange, annSlug, metadata.title],
    )

    const {type, as} = metadata

    // Boolean type
    if (type === "boolean") {
        if (as === "GroupTab" && metadata.options) {
            return (
                <BooleanGroupTab
                    label={metadata.title}
                    value={metadata.value as boolean | string | null}
                    onChange={handleChange as (value: boolean | string | null) => void}
                    disabled={metadata.disabled}
                    options={metadata.options as {label: string; value: boolean | string}[]}
                    description={metadata.description}
                    allowClear={metadata.allowClear}
                    disableClear={metadata.disableClear}
                />
            )
        }
        // Default boolean as radio group with True/False (using boolean values)
        return (
            <BooleanGroupTab
                label={metadata.title}
                value={metadata.value as boolean | string | null}
                onChange={handleChange as (value: boolean | string | null) => void}
                disabled={metadata.disabled}
                options={[
                    {label: "True", value: true},
                    {label: "False", value: false},
                ]}
                description={metadata.description}
            />
        )
    }

    // Number/integer type
    if (type === "number" || type === "integer") {
        const useSlider = metadata.minimum !== undefined && metadata.maximum !== undefined
        return (
            <NumberInput
                label={metadata.title}
                value={metadata.value as number | null}
                onChange={handleChange as (value: number | null) => void}
                disabled={metadata.disabled}
                min={metadata.minimum}
                max={metadata.maximum}
                step={metadata.step ?? (type === "integer" ? 1 : 0.1)}
                description={metadata.description}
                useSlider={useSlider}
            />
        )
    }

    // String type with options (select)
    if (type === "string" && metadata.options) {
        return (
            <SelectInput
                label={metadata.title}
                value={metadata.value as string | null}
                onChange={handleChange as (value: string | string[] | null) => void}
                disabled={metadata.disabled}
                options={metadata.options}
                description={metadata.description}
                mode={metadata.mode}
                placeholder={metadata.placeholder}
            />
        )
    }

    // Array type (multi-select)
    if (type === "array") {
        return (
            <SelectInput
                label={metadata.title}
                value={metadata.value as string[] | null}
                onChange={handleChange as (value: string | string[] | null) => void}
                disabled={metadata.disabled}
                options={metadata.options}
                description={metadata.description}
                mode="multiple"
                placeholder={metadata.placeholder}
            />
        )
    }

    // Default: string input
    return (
        <StringInput
            label={metadata.title}
            value={metadata.value as string | null}
            onChange={handleChange as (value: string | null) => void}
            disabled={metadata.disabled}
            placeholder={metadata.placeholder}
            description={metadata.description}
        />
    )
})
