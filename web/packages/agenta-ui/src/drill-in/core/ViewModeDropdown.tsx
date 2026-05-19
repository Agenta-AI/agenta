/**
 * ViewModeDropdown
 *
 * "View as ▾" dropdown used in both `DrillInRootToolbar` and
 * `DrillInFieldHeader`. Renders a plain antd `Dropdown` so menu styling
 * follows the host theme.
 */

import {memo} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button as AntdButton, Dropdown} from "antd"
import type {MenuProps} from "antd"

export interface ViewModeDropdownOption<TValue extends string = string> {
    value: TValue
    label: string
}

export interface ViewModeDropdownProps<TValue extends string = string> {
    value: TValue
    options: ViewModeDropdownOption<TValue>[]
    onChange: (value: TValue) => void
}

function ViewModeDropdownInner<TValue extends string = string>({
    value,
    options,
    onChange,
}: ViewModeDropdownProps<TValue>) {
    const selectedOption = options.find((option) => option.value === value)
    const items: MenuProps["items"] = options.map((option) => ({
        key: option.value,
        label: option.label,
        onClick: () => onChange(option.value),
    }))

    return (
        <Dropdown menu={{items, selectedKeys: [value]}} trigger={["click"]} placement="bottomRight">
            <AntdButton
                type="text"
                size="small"
                style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "0 8px",
                    height: 24,
                    fontSize: 12,
                    color: "#051729",
                }}
            >
                <span style={{color: "rgba(5, 23, 41, 0.55)"}}>
                    View as{" "}
                    <span style={{color: "#051729", fontWeight: 600}}>
                        {selectedOption?.label ?? value}
                    </span>
                </span>
                <CaretDown size={12} style={{marginTop: 1, opacity: 0.65}} />
            </AntdButton>
        </Dropdown>
    )
}

export const ViewModeDropdown = memo(ViewModeDropdownInner) as typeof ViewModeDropdownInner
