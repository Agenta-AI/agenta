import {memo, useMemo} from "react"

import {Select, Tooltip, Typography} from "antd"

import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControlWrapper"

import type {SelectControlProps} from "./types"

/**
 * A select control component that supports both single and multiple selection modes.
 *
 * @remarks
 * - Handles both flat and grouped option structures
 * - Automatically transforms string arrays into proper option objects
 * - Supports dynamic option grouping through object notation
 * - Maintains consistent option format regardless of input structure
 */
const SelectControl = ({
    withTooltip,
    description,
    mode,
    label,
    options: _options,
    value,
    disabled,
    onChange,
}: SelectControlProps) => {
    /**
     * Transforms raw options into standardized select options
     * Handles both array-based and group-based option structures
     */
    const options = useMemo(() => {
        if (!_options) return []
        if (Array.isArray(_options)) {
            return _options
        }
        return Object.keys(_options).map((group) => ({
            label: group,
            options: _options[group].map((option) => ({
                value: option,
                label: option,
            })),
        }))
    }, [_options])

    return (
        <PlaygroundVariantPropertyControlWrapper>
            {withTooltip ? (
                <Tooltip title={description}>
                    <Typography.Text className="w-fit">{label}</Typography.Text>
                </Tooltip>
            ) : (
                <Typography.Text>{label}</Typography.Text>
            )}
            <Select<string | string[]>
                showSearch
                mode={mode}
                value={value}
                onChange={onChange}
                options={options}
                disabled={disabled}
                filterOption={(input, option) =>
                    (option?.label?.toLocaleString() ?? "")
                        .toLowerCase()
                        .includes(input.toLowerCase())
                }
            />
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default memo(SelectControl)
