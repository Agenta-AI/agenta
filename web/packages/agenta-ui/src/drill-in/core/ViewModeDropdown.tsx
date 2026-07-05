import {memo} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {CaretDown} from "@phosphor-icons/react"

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
            <DropdownMenuTrigger
                disabled={disabled}
                className="inline-flex h-6 items-center gap-1 px-2 text-xs rounded-[min(var(--radius-md),12px)] font-medium text-[var(--ag-c-051729)] transition-all outline-none select-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5"
            >
                <span className="font-medium">{selectedOption?.label ?? value}</span>
                <CaretDown size={14} className="mt-px opacity-65" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                    value={value}
                    onValueChange={(v: string) => onChange(v as TValue)}
                >
                    {options.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                            {option.label}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export const ViewModeDropdown = memo(ViewModeDropdownInner) as typeof ViewModeDropdownInner
