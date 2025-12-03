import {useCallback, useMemo, useState, type ReactNode} from "react"

import {Funnel} from "@phosphor-icons/react"
import {Button, Popover} from "antd"
import type {ButtonProps} from "antd"
import type {PopoverProps} from "antd/es/popover"

interface FiltersPopoverTriggerProps {
    label?: ReactNode
    filterCount?: number
    buttonType?: ButtonProps["type"]
    icon?: ReactNode
    renderContent: (close: () => void, context: {isOpen: boolean}) => ReactNode
    placement?: PopoverProps["placement"]
    initialOpen?: boolean
    buttonProps?: Omit<ButtonProps, "type" | "icon">
    popoverProps?: Omit<PopoverProps, "content" | "children" | "trigger" | "open" | "onOpenChange">
    onOpenChange?: (open: boolean) => void
}

const FilterCountBadge = ({count}: {count: number}) => (
    <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] !px-1 rounded-md bg-[#E5E7EB] text-[#374151] text-xs font-medium">
        {count}
    </span>
)

const FiltersPopoverTrigger = ({
    label,
    filterCount = 0,
    buttonType = "default",
    icon,
    renderContent,
    placement = "bottomRight",
    initialOpen = false,
    buttonProps,
    popoverProps,
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

    console.log("buttonProps", {buttonProps})

    return (
        <Popover
            trigger="click"
            placement={placement}
            open={isOpen}
            onOpenChange={handleOpenChange}
            content={content}
            destroyOnHidden
            {...popoverProps}
        >
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
        </Popover>
    )
}

export default FiltersPopoverTrigger
