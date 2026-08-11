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

import {bgColors, flexLayouts} from "../../../utils/styles"
import {Button} from "../../ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
// The tailwind-merge `cn`, not the clsx-only one in utils/styles: this composes against
// `buttonVariants`, and clsx keeps `px-btn px-2` both, letting stylesheet order win.
import {cn} from "../../ui/utils"

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
    const menuItems = useMemo(() => {
        return options.map((item) => ({
            key: item.key ?? item.value,
            value: item.value,
            label: item.label,
            disabled: item.disabled,
        }))
    }, [options])

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
                <Button
                    className={cn(
                        flexLayouts.rowCenter,
                        "capitalize px-2",
                        bgColors.hoverState,
                        className,
                    )}
                    variant="ghost"
                >
                    {value || placeholder} <CaretUpDown size={14} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[150px]">
                {menuItems.map((item) => (
                    <DropdownMenuItem
                        key={item.key}
                        className="capitalize"
                        disabled={item.disabled}
                        onClick={() => onChange(item.value)}
                    >
                        {item.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default SimpleDropdownSelect
