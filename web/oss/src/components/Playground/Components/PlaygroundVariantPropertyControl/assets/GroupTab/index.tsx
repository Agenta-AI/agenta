import {memo, useCallback} from "react"

import {X} from "@phosphor-icons/react"
import {Typography, Tooltip, Button, Radio} from "antd"

import {useDebounceInput} from "@/oss/hooks/useDebounceInput"

import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControlWrapper"

import type {GroupTabProps} from "./types"

/**
 * A controlled input component that combines a group of radio buttons
 * for option selection, with an optional clear action.
 *
 * @remarks
 * - Maintains internal state for immediate UI updates while debouncing parent state updates
 * - Option selection and clear actions are debounced to prevent excessive updates
 * - Falls back to null when the value is cleared or not provided
 * - Optionally displays a tooltip and label
 */
const GroupTab = ({
    label,
    value,
    description,
    withTooltip,
    onChange,
    disabled,
    options,
    allowClear = false,
    disableClear = false,
}: GroupTabProps) => {
    const [localValue, setLocalValue] = useDebounceInput<string | null>(
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
        (newValue: string | null) => {
            setLocalValue(newValue)
        },
        [setLocalValue],
    )

    return (
        <PlaygroundVariantPropertyControlWrapper className="!gap-0 mb-0">
            <Tooltip title={description || ""} placement="right">
                <div className="flex items-center gap-2 justify-between">
                    <Typography.Text className="playground-property-control-label">
                        {label}
                    </Typography.Text>

                    <div className="flex items-center gap-1">
                        <Radio.Group
                            onChange={(e) => handleValueChange(e.target.value)}
                            value={localValue ?? ""}
                            disabled={disabled}
                        >
                            {options?.map((option) => (
                                <Radio.Button key={option.value} value={option.value}>
                                    {option.label}
                                </Radio.Button>
                            ))}
                        </Radio.Group>

                        {localValue !== null || allowClear ? (
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
            </Tooltip>
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default memo(GroupTab)
