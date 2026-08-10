/**
 * ViewModeDropdown
 *
 * "View as ▾" dropdown used in both `DrillInRootToolbar` and
 * `DrillInFieldHeader`. Renders the @agenta/ui `DropdownMenu` primitive.
 */

import {memo} from "react"

import {CaretDown} from "@phosphor-icons/react"

import {Button as AntdButton} from "../../components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"

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

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
                <AntdButton
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className="inline-flex h-6 items-center gap-1 px-2 text-xs text-colorText"
                >
                    <span className="font-medium">{selectedOption?.label ?? value}</span>
                    <CaretDown size={14} className="mt-px opacity-65" />
                </AntdButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {options.map((option) => (
                    <DropdownMenuItem
                        key={option.value}
                        onClick={() => onChange(option.value)}
                        // antd `selectedKeys` highlight.
                        className={
                            option.value === value
                                ? "bg-controlItemBgActive text-colorPrimary"
                                : undefined
                        }
                    >
                        {option.label}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export const ViewModeDropdown = memo(ViewModeDropdownInner) as typeof ViewModeDropdownInner
