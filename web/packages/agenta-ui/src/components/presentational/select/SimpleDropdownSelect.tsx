/**
 * SimpleDropdownSelect Component
 *
 * A simple dropdown select component using Antd Dropdown.
 * Used for role selection in chat message editors and other simple selections.
 *
 * @example
 * ```tsx
 * import { SimpleDropdownSelect } from '@agenta/ui'
 *
 * const roleOptions = [
 *   { label: 'User', value: 'user' },
 *   { label: 'Assistant', value: 'assistant' },
 *   { label: 'System', value: 'system' },
 * ]
 *
 * <SimpleDropdownSelect
 *   value={role}
 *   options={roleOptions}
 *   onChange={(value) => setRole(value)}
 * />
 * ```
 */

import {useMemo} from "react"

import {CaretUpDown} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import type {MenuProps} from "antd"

import {cn} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

/** Menu item type for dropdown options */
export interface DropdownMenuItem {
    key?: string
    label: string
    value: string
    disabled?: boolean
}

export interface SimpleDropdownSelectProps {
    /**
     * Currently selected value
     */
    value: string
    /**
     * Available options
     */
    options: DropdownMenuItem[]
    /**
     * Callback when selection changes
     */
    onChange: (value: string) => void
    /**
     * Placeholder text when no value is selected
     * @default "Select..."
     */
    placeholder?: string
    /**
     * Additional CSS class name
     */
    className?: string
    /**
     * Whether the dropdown is disabled
     */
    disabled?: boolean
    /**
     * Description for accessibility (not currently used)
     */
    description?: string
    /**
     * Whether to show tooltip on hover (not currently used)
     */
    withTooltip?: boolean
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A simple dropdown select component using Antd Dropdown.
 * Shows a button trigger with the current value and a chevron icon.
 */
export function SimpleDropdownSelect({
    value,
    options,
    onChange,
    placeholder = "Select...",
    className,
    disabled,
}: SimpleDropdownSelectProps) {
    const menuItems: MenuProps["items"] = useMemo(() => {
        return options.map((item) => ({
            key: item.key ?? item.value,
            label: item.label,
            className: "capitalize",
            onClick: () => onChange(item.value),
            disabled: item.disabled,
        }))
    }, [options, onChange])

    return (
        <Dropdown
            disabled={disabled}
            menu={{items: menuItems}}
            trigger={["click"]}
            styles={{
                root: {
                    width: 150,
                },
            }}
        >
            <Button
                className={cn(
                    "capitalize flex items-center px-[7px] hover:!bg-[rgba(5,23,41,0.15)]",
                    className,
                )}
                type="text"
            >
                {value || placeholder} <CaretUpDown size={14} />
            </Button>
        </Dropdown>
    )
}

export default SimpleDropdownSelect
