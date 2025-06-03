import {memo, useCallback} from "react"

import {X} from "@phosphor-icons/react"
import {Slider, InputNumber, Typography, Tooltip, Button} from "antd"
import clsx from "clsx"

import {useDebounceInput} from "@/oss/hooks/useDebounceInput"

import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControlWrapper"

import type {MinMaxControlProps} from "./types"

/**
 * A controlled input component that combines a slider and number input
 * for numerical value selection within a defined range.
 *
 * @remarks
 * - Maintains internal state for immediate UI updates while debouncing parent state updates
 * - Both slider and input changes are debounced to prevent excessive updates
 * - Falls back to min value when null/undefined is provided
 */
const MinMaxControl = ({
    label,
    min,
    max,
    step,
    value,
    description,
    withTooltip,
    onChange,
    disabled,
    placeholder,
    allowClear = false,
    disableClear = false,
    className,
}: MinMaxControlProps) => {
    const [localValue, setLocalValue] = useDebounceInput<number | null>(
        value ?? null,
        onChange,
        300,
        null,
    )

    /**
     * Unified change handler for both input methods
     * Provides immediate visual feedback while debouncing actual state updates
     */
    const handleValueChange = useCallback(
        (newValue: number | null | undefined) => {
            const processedValue = newValue === undefined ? null : newValue
            setLocalValue(processedValue)
        },
        [setLocalValue],
    )

    return (
        <PlaygroundVariantPropertyControlWrapper className={clsx("!gap-0 mb-0", className)}>
            <Tooltip title={description || ""} placement="right">
                <div className="flex items-center gap-2 justify-between">
                    <Typography.Text className="playground-property-control-label">
                        {label}
                    </Typography.Text>

                    <div className="flex items-center gap-1">
                        <InputNumber
                            min={min}
                            max={max}
                            step={step}
                            value={localValue}
                            onChange={handleValueChange}
                            disabled={disabled}
                            className="w-[60px] [&_input]:!text-center [&:hover_input]:!text-left [&_input]:!capitalize"
                            placeholder={placeholder}
                        />

                        {localValue || localValue === 0 || allowClear ? (
                            <Button
                                icon={<X size={14} />}
                                type="text"
                                size="small"
                                onClick={() => handleValueChange(null)}
                                disabled={disabled || disableClear}
                            />
                        ) : null}
                    </div>
                </div>

                <Slider
                    min={min}
                    max={max}
                    step={step}
                    value={localValue ?? min}
                    disabled={disabled}
                    onChange={handleValueChange}
                    classNames={{track: "!bg-[#1C2C3D]"}}
                />
            </Tooltip>
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default memo(MinMaxControl)
