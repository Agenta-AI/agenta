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
    /** When true, both the trigger button and the menu are disabled. */
    disabled?: boolean
}

function ViewModeDropdownInner<TValue extends string = string>({
    value,
    options,
    onChange,
    disabled,
}: ViewModeDropdownProps<TValue>) {
    const selectedOption = options.find((option) => option.value === value)
    const items: MenuProps["items"] = options.map((option) => ({
        key: option.value,
        label: option.label,
        onClick: () => onChange(option.value),
    }))

    return (
        <Dropdown
            menu={{items, selectedKeys: [value]}}
            trigger={["click"]}
            placement="bottomRight"
            disabled={disabled}
        >
            <AntdButton
                type="text"
                size="small"
                disabled={disabled}
                className="inline-flex h-6 items-center gap-1 px-2 text-xs text-[var(--ag-c-051729)]"
            >
                <span className="font-medium">{selectedOption?.label ?? value}</span>
                <CaretDown size={14} className="mt-px opacity-65" />
            </AntdButton>
        </Dropdown>
    )
}

export const ViewModeDropdown = memo(ViewModeDropdownInner) as typeof ViewModeDropdownInner
