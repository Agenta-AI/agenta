import {memo, useMemo} from "react"

import {X} from "@phosphor-icons/react"
import {Button, Select, Tooltip, Typography} from "antd"
import clsx from "clsx"

import PlaygroundVariantPropertyControlWrapper from "../PlaygroundVariantPropertyControlWrapper"

import {ALL_LABEL_MAPS, SELECT_DEFAULT_VALUE_MAPS, SELECT_LABEL_MAPS} from "./constants"
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
    label: propsLabel,
    options: _options,
    value: propsValue,
    disabled,
    size = "small",
    className,
    onChange,
    showSearch = true,
    allowClear = false,
    disableClear = false,
    ...rest
}: SelectControlProps) => {
    /**
     * Transforms raw options into standardized select options
     * Handles both array-based and group-based option structures
     */
    const label = useMemo(() => {
        return SELECT_LABEL_MAPS[propsLabel || ""] ?? propsLabel
    }, [propsLabel])

    const value = useMemo(() => {
        return propsValue ?? SELECT_DEFAULT_VALUE_MAPS[propsLabel || ""]
    }, [propsValue, propsLabel])

    const options = useMemo(() => {
        if (!_options) return []
        if (Array.isArray(_options)) {
            return _options.map((option) => ({
                className: option?.className || "",
                value: option.value || option,
                label: ALL_LABEL_MAPS[option.value || ""] || option.label || option.value || option,
            }))
        }
        return Object.keys(_options).map((group) => ({
            label: group,
            options: _options[group].map((option) => ({
                value: option,
                label: ALL_LABEL_MAPS[option] || option,
            })),
        }))
    }, [_options])

    return (
        <PlaygroundVariantPropertyControlWrapper className="multi-select-control">
            {!!label && withTooltip ? (
                <Tooltip title={description}>
                    <Typography.Text className="playground-property-control-label w-fit">
                        {label}
                    </Typography.Text>
                </Tooltip>
            ) : label ? (
                <Typography.Text className="playground-property-control-label">
                    {label}
                </Typography.Text>
            ) : null}
            <div className="flex items-center gap-2">
                <Select<string | string[]>
                    showSearch={showSearch}
                    mode={mode}
                    size={size}
                    value={value || null}
                    onChange={onChange}
                    options={options}
                    popupMatchSelectWidth={false}
                    disabled={disabled}
                    filterOption={(input, option) =>
                        (option?.label?.toLocaleString() ?? "")
                            .toLowerCase()
                            .includes(input.toLowerCase())
                    }
                    className={clsx(["w-full", className])}
                    placeholder={mode === "multiple" ? "Select multiple" : "Select one"}
                    {...rest}
                />
                {value?.length || allowClear ? (
                    <Button
                        icon={<X size={14} />}
                        type="text"
                        size="small"
                        onClick={() => onChange?.("")}
                        disabled={disabled || disableClear}
                    />
                ) : null}
            </div>
        </PlaygroundVariantPropertyControlWrapper>
    )
}

export default memo(SelectControl)
