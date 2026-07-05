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

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {CaretUpDown} from "@phosphor-icons/react"

import {bgColors, cn, flexLayouts} from "../../../utils/styles"

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
 * A simple dropdown select component using shadcn-style DropdownMenu.
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
    const selectedOption = useMemo(
        () => options.find((item) => item.value === value),
        [options, value],
    )

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                disabled={disabled}
                className={cn(
                    flexLayouts.rowCenter,
                    "capitalize px-2 h-7 gap-1 rounded-lg text-sm font-medium transition-all outline-none select-none border border-border bg-background hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
                    bgColors.hoverState,
                    className,
                )}
                style={{width: 150}}
            >
                {selectedOption?.label || value || placeholder}
                <CaretUpDown size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" style={{width: 150}}>
                <DropdownMenuRadioGroup
                    value={value}
                    onValueChange={(newValue: string) => onChange(newValue)}
                >
                    {options.map((item) => (
                        <DropdownMenuRadioItem
                            key={item.key ?? item.value}
                            value={item.value}
                            disabled={item.disabled}
                            className="capitalize"
                            closeOnClick
                        >
                            {item.label}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default SimpleDropdownSelect
