import {useCallback, useMemo, useState, type ReactNode} from "react"

import {FunnelSimple} from "@phosphor-icons/react"
import {Button, Popover} from "antd"
import type {ButtonProps} from "antd"
import type {PopoverProps} from "antd/es/popover"

interface FiltersPopoverTriggerProps {
    label?: ReactNode
    buttonType?: ButtonProps["type"]
    icon?: ReactNode
    renderContent: (close: () => void, context: {isOpen: boolean}) => ReactNode
    placement?: PopoverProps["placement"]
    initialOpen?: boolean
    buttonProps?: Omit<ButtonProps, "type" | "icon" | "onClick">
    popoverProps?: Omit<PopoverProps, "content" | "children" | "trigger" | "open" | "onOpenChange">
    onOpenChange?: (open: boolean) => void
}

const FiltersPopoverTrigger = ({
    label = "Filters",
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
                icon={icon ?? <FunnelSimple size={16} />}
                type={buttonType}
                {...buttonProps}
                onClick={(event) => {
                    event.stopPropagation()
                    buttonProps?.onClick?.(event)
                }}
            >
                {label}
            </Button>
        </Popover>
    )
}

export default FiltersPopoverTrigger
