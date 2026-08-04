/**
 * SliderInput Component
 *
 * A base component combining a slider and number input for numeric range selection.
 * Used for temperature, max tokens, top P, penalties, and other numeric parameters.
 *
 * Migrated off antd: the number field is the `@agenta/ui` `InputNumber` primitive and the
 * track is the `@agenta/ui` `Slider` primitive (Radix). The public `SliderInputProps`
 * surface is unchanged, so the hand-rolled antd `Slider` + `InputNumber` pairs still in the
 * app (`SamplingRateControl.tsx`, `MetricField.tsx`) can adopt it without an API change.
 *
 * @example
 * ```tsx
 * import { SliderInput } from '@agenta/ui'
 *
 * <SliderInput
 *   value={0.7}
 *   onChange={(v) => setTemperature(v)}
 *   min={0}
 *   max={2}
 *   step={0.1}
 * />
 * ```
 */

import {memo, useCallback, useEffect, useState} from "react"

import {XCircle} from "@phosphor-icons/react"

import {cn, flexLayouts, gapClasses} from "../../../utils/styles"
import {Button} from "../../ui/button"
import {InputNumber} from "../../ui/input-number"
import {Slider} from "../../ui/slider"

// ============================================================================
// TYPES
// ============================================================================

export interface SliderInputProps {
    /** Current value */
    value: number | null | undefined
    /** Change handler */
    onChange: (value: number | null) => void
    /** Minimum value */
    min?: number
    /** Maximum value */
    max?: number
    /** Step increment */
    step?: number
    /** Disable the control */
    disabled?: boolean
    /** Allow clearing (show X button) */
    allowClear?: boolean
    /** Input width */
    inputWidth?: number | string
    /** Placeholder text */
    placeholder?: string
    /** Additional CSS classes */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A controlled input component that combines a slider and number input
 * for numerical value selection within a defined range.
 */
export const SliderInput = memo(function SliderInput({
    value,
    onChange,
    min = 0,
    max = 1,
    step = 0.1,
    disabled = false,
    allowClear = true,
    inputWidth = 70,
    placeholder,
    className,
}: SliderInputProps) {
    // Local state for immediate UI feedback
    const [localValue, setLocalValue] = useState<number | null>(value ?? null)

    // Sync local state with external value
    useEffect(() => {
        setLocalValue(value ?? null)
    }, [value])

    // Handle value changes with immediate local update
    const handleValueChange = useCallback(
        (newValue: number | null | undefined) => {
            const processedValue = newValue === undefined ? null : newValue
            setLocalValue(processedValue)
            onChange(processedValue)
        },
        [onChange],
    )

    // Radix reports an array of thumb values; this control has exactly one thumb.
    const handleSliderChange = useCallback(
        (next: number[]) => {
            handleValueChange(next[0])
        },
        [handleValueChange],
    )

    return (
        <div className={cn(flexLayouts.column, gapClasses.xs, className)}>
            <div className={cn(flexLayouts.rowCenter, gapClasses.xs)}>
                <InputNumber
                    min={min}
                    max={max}
                    step={step}
                    value={localValue}
                    onChange={handleValueChange}
                    disabled={disabled}
                    className="[&_input]:!text-center"
                    style={{width: inputWidth}}
                    placeholder={placeholder}
                    size="small"
                />

                {allowClear && localValue !== null && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleValueChange(null)}
                        disabled={disabled}
                    >
                        {<XCircle size={14} />}
                    </Button>
                )}
            </div>

            <Slider
                min={min}
                max={max}
                step={step}
                value={[localValue ?? min]}
                disabled={disabled}
                onValueChange={handleSliderChange}
            />
        </div>
    )
})

export default SliderInput
