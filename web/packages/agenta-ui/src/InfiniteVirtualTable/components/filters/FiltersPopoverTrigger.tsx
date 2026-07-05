import {useCallback, useMemo, useState, type ReactNode} from "react"

import {
    Popover,
    PopoverContent,
    PopoverTrigger,
    type PopoverAlign,
    type PopoverContentProps,
    type PopoverSide,
} from "@agenta/primitive-ui/components/popover"
import {Funnel} from "@phosphor-icons/react"
import {Button} from "antd"
import type {ButtonProps} from "antd"

interface FiltersPopoverTriggerProps {
    label?: ReactNode
    filterCount?: number
    buttonType?: ButtonProps["type"]
    icon?: ReactNode
    renderContent: (close: () => void, context: {isOpen: boolean}) => ReactNode
    side?: PopoverSide
    align?: PopoverAlign
    initialOpen?: boolean
    buttonProps?: Omit<ButtonProps, "type" | "icon">
    contentProps?: Omit<PopoverContentProps, "children" | "side" | "align">
    onOpenChange?: (open: boolean) => void
}

const FilterCountBadge = ({count}: {count: number}) => (
    <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] !px-1 rounded-md bg-[var(--ag-c-E5E7EB)] text-[var(--ag-c-374151)] text-xs font-medium">
        {count}
    </span>
)

const FiltersPopoverTrigger = ({
    label,
    filterCount = 0,
    buttonType = "default",
    icon,
    renderContent,
    side = "bottom",
    align = "end",
    initialOpen = false,
    buttonProps,
    contentProps,
    onOpenChange,
}: FiltersPopoverTriggerProps) => {
    const [isOpen, setIsOpen] = useState(initialOpen)

    const handleOpenChange = useCallback(
        (open: boolean) => {
            setIsOpen(open)
            onOpenChange?.(open)
        },
        [onOpenChange],
    )

    const content = useMemo(
        () => renderContent(() => setIsOpen(false), {isOpen}),
        [renderContent, isOpen],
    )

    return (
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverTrigger
                render={
                    <Button
                        icon={icon ?? <Funnel size={16} />}
                        type="default"
                        {...buttonProps}
                        onClick={(event) => {
                            event.stopPropagation()
                            buttonProps?.onClick?.(event)
                        }}
                        className="flex items-center gap-2 !px-1.5"
                    >
                        {label}
                        <FilterCountBadge count={filterCount} />
                    </Button>
                }
            />
            <PopoverContent side={side} align={align} {...contentProps}>
                {content}
            </PopoverContent>
        </Popover>
    )
}

export default FiltersPopoverTrigger
