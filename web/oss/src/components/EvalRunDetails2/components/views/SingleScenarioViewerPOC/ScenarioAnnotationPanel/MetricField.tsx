import {memo, useCallback, useMemo} from "react"

import {InputNumber, Radio, Select, Slider, Typography} from "antd"
import clsx from "clsx"

interface MetricFieldProps {
    fieldKey: string
    field: Record<string, unknown>
    schema: Record<string, unknown>
    disabled?: boolean
    onChange: (value: unknown) => void
}

const NUMERIC_TYPES = ["number", "integer", "float"]

/**
 * MetricField renders an individual annotation field based on its type.
 * This is a reliable, self-contained implementation that doesn't depend on
 * external render maps that might return undefined.
 */
const MetricField = ({fieldKey, field, schema, disabled = false, onChange}: MetricFieldProps) => {
    const type = (field as {type?: string}).type ?? (schema as {type?: string}).type ?? "string"
    const value = (field as {value?: unknown}).value
    const minimum = (field as {minimum?: number}).minimum ?? (schema as {minimum?: number}).minimum
    const maximum = (field as {maximum?: number}).maximum ?? (schema as {maximum?: number}).maximum
    const items =
        (field as {items?: {enum?: string[]}}).items ??
        (schema as {items?: {enum?: string[]}}).items
    const anyOf = (schema as {anyOf?: unknown[]}).anyOf

    // Handle anyOf (class/enum types)
    const enumOptions = useMemo(() => {
        if (anyOf && Array.isArray(anyOf) && anyOf.length > 0) {
            const firstOption = anyOf[0] as {enum?: unknown[]}
            if (firstOption?.enum) {
                return firstOption.enum.map((item) => ({
                    label: item === null ? "None of the above" : String(item),
                    value: item === null ? "null" : String(item),
                }))
            }
        }
        return null
    }, [anyOf])

    // Handle array items enum (label/tag types)
    const tagOptions = useMemo(() => {
        if (type === "array" && items?.enum) {
            return items.enum.map((item: string) => ({
                label: item,
                value: item,
            }))
        }
        return null
    }, [type, items])

    const handleChange = useCallback(
        (newValue: unknown) => {
            onChange(newValue)
        },
        [onChange],
    )

    // Render based on type
    if (type === "boolean") {
        return (
            <div className="flex flex-col gap-1">
                <Typography.Text className="text-sm font-medium">{fieldKey}</Typography.Text>
                <Radio.Group
                    value={value}
                    onChange={(e) => handleChange(e.target.value)}
                    disabled={disabled}
                    className="flex gap-2"
                >
                    <Radio.Button value={true}>True</Radio.Button>
                    <Radio.Button value={false}>False</Radio.Button>
                    <Radio.Button value={null}>Clear</Radio.Button>
                </Radio.Group>
            </div>
        )
    }

    if (NUMERIC_TYPES.includes(type)) {
        const hasRange = minimum !== undefined && maximum !== undefined
        const step = type === "integer" ? 1 : 0.1

        return (
            <div className="flex flex-col gap-1">
                <Typography.Text className="text-sm font-medium">{fieldKey}</Typography.Text>
                <div className="flex items-center gap-3">
                    {hasRange && (
                        <Slider
                            min={minimum}
                            max={maximum}
                            step={step}
                            value={typeof value === "number" ? value : minimum}
                            onChange={handleChange}
                            disabled={disabled}
                            className="flex-1"
                        />
                    )}
                    <InputNumber
                        min={minimum}
                        max={maximum}
                        step={step}
                        value={value as number | null}
                        onChange={handleChange}
                        disabled={disabled}
                        placeholder={type}
                        className={clsx(hasRange ? "w-20" : "w-full")}
                    />
                </div>
            </div>
        )
    }

    if (enumOptions) {
        // Class/enum type - single select
        return (
            <div className="flex flex-col gap-1">
                <Typography.Text className="text-sm font-medium">{fieldKey}</Typography.Text>
                <Select
                    value={value === null ? "null" : (value as string)}
                    onChange={(val) => handleChange(val === "null" ? null : val)}
                    options={enumOptions}
                    disabled={disabled}
                    allowClear
                    placeholder="Select a value"
                    className="w-full"
                />
            </div>
        )
    }

    if (tagOptions) {
        // Array/tag type - multi select
        return (
            <div className="flex flex-col gap-1">
                <Typography.Text className="text-sm font-medium">{fieldKey}</Typography.Text>
                <Select
                    mode="tags"
                    value={Array.isArray(value) ? value : []}
                    onChange={handleChange}
                    options={tagOptions}
                    disabled={disabled}
                    allowClear
                    placeholder="Select or enter values"
                    className="w-full"
                />
            </div>
        )
    }

    // Default: string input (using Select for consistency, but could use Input)
    return (
        <div className="flex flex-col gap-1">
            <Typography.Text className="text-sm font-medium">{fieldKey}</Typography.Text>
            <Select
                mode="tags"
                value={value ? [value as string] : []}
                onChange={(vals) => handleChange(vals?.[0] ?? "")}
                disabled={disabled}
                allowClear
                placeholder="Enter value"
                className="w-full"
            />
        </div>
    )
}

export default memo(MetricField)
