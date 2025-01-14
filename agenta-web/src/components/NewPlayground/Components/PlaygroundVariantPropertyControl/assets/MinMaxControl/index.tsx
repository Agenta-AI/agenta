import {memo, useCallback, useState, useEffect} from "react"

import {Slider, InputNumber, Typography} from "antd"
import debounce from "lodash/debounce"

import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControlWrapper"

import type {MinMaxControlProps} from "./types"
import {useDebounceValue} from "usehooks-ts"

/**
 * A controlled input component that combines a slider and number input
 * for numerical value selection within a defined range.
 *
 * @remarks
 * - Maintains internal state for immediate UI updates while debouncing parent state updates
 * - Both slider and input changes are debounced to prevent excessive updates
 * - Falls back to min value when null/undefined is provided
 */
const MinMaxControl = ({label, min, max, step, value, onChange}: MinMaxControlProps) => {
    // Internal state for smooth UI updates
    const [localValue, setLocalValue] = useState<number | null>(value ?? null)
    const [query] = useDebounceValue(localValue, 300)

    useEffect(() => {
        if (query !== null) {
            onChange(query)
        }
    }, [onChange, query])

    /**
     * Syncs internal state with external value changes
     * Important for controlled component behavior
     */
    useEffect(() => {
        setLocalValue((prevValue) => {
            const newValue = value || null
            if (newValue !== prevValue) {
                return newValue
            }
            return prevValue
        })
    }, [value])

    /**
     * Unified change handler for both input methods
     * Provides immediate visual feedback while debouncing actual state updates
     */
    const handleValueChange = useCallback((newValue: number | null | undefined) => {
        const processedValue = newValue === undefined ? null : newValue
        setLocalValue(processedValue) // Update UI immediately
        // debouncedOnChange(processedValue) // Debounce update to parent
    }, [])

    return (
        <PlaygroundVariantPropertyControlWrapper className="!gap-0 mb-0">
            <div className="flex items-center gap-2 justify-between">
                <Typography.Text>{label}</Typography.Text>
                <InputNumber
                    min={min}
                    max={max}
                    step={step}
                    value={localValue}
                    onChange={handleValueChange}
                    className="w-[60px] [&_input]:!text-center [&:hover_input]:!text-left"
                />
            </div>
            <Slider
                min={min}
                max={max}
                step={step}
                value={localValue ?? min}
                onChange={handleValueChange}
            />
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default memo(MinMaxControl)
