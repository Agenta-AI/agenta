import {InitialsAvatar} from "@agenta/ui"
import {CaretDown} from "@phosphor-icons/react"
import {Button} from "antd"
import type {ButtonProps} from "antd"
import clsx from "clsx"

interface SidebarSelectionButtonProps {
    collapsed: boolean
    label: string
    placeholder: string
    isOpen: boolean
    showCaret: boolean
    disabled?: boolean
    buttonProps?: ButtonProps
}

const SidebarSelectionButton = ({
    collapsed,
    label,
    placeholder,
    isOpen,
    showCaret,
    disabled = false,
    buttonProps,
}: SidebarSelectionButtonProps) => {
    const {className, type, disabled: buttonDisabled, ...restButtonProps} = buttonProps ?? {}
    const displayLabel = label || placeholder

    return (
        <Button
            type={type ?? "text"}
            className={clsx(
                "flex items-center justify-between overflow-hidden h-9 transition-[width,padding,gap] duration-300 ease-in-out",
                collapsed ? "!w-8 !p-1 gap-0" : "w-full px-1.5 py-3 gap-2",
                className,
            )}
            disabled={disabled || buttonDisabled}
            {...restButtonProps}
        >
            <div
                className={clsx(
                    "flex min-w-0 items-center transition-[gap] duration-300 ease-in-out",
                    collapsed ? "gap-0" : "gap-2",
                )}
            >
                <InitialsAvatar size="small" name={displayLabel} />
                <span
                    className={clsx(
                        "max-w-[150px] truncate overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out",
                        collapsed ? "!max-w-0 opacity-0" : "opacity-100",
                    )}
                    title={displayLabel}
                    aria-hidden={collapsed}
                >
                    {displayLabel}
                </span>
            </div>
            <span
                className={clsx(
                    "flex shrink-0 items-center overflow-hidden transition-[width,opacity] duration-300 ease-in-out",
                    !collapsed && showCaret ? "w-3.5 opacity-100" : "w-0 opacity-0",
                )}
                aria-hidden={collapsed || !showCaret}
            >
                <CaretDown
                    size={14}
                    className={clsx("transition-transform", isOpen && "rotate-180")}
                />
            </span>
        </Button>
    )
}

export default SidebarSelectionButton
