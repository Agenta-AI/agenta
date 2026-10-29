import type {ButtonHTMLAttributes} from "react"

import {InitialsAvatar} from "@agenta/ui/components/presentational"
import {CaretDown} from "@phosphor-icons/react"
import clsx from "clsx"

export interface SidebarSelectionButtonProps extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "children"
> {
    collapsed: boolean
    label: string
    placeholder: string
    isOpen: boolean
    showCaret: boolean
}

/**
 * The rail's selection trigger (org/project, workflow): avatar + label + caret, collapsing
 * to the avatar alone with the rail. Ported from the OSS antd Button verbatim, styling and
 * transitions included.
 */
export const SidebarSelectionButton = ({
    collapsed,
    label,
    placeholder,
    isOpen,
    showCaret,
    disabled = false,
    className,
    ...buttonProps
}: SidebarSelectionButtonProps) => {
    const displayLabel = label || placeholder

    return (
        <button
            type="button"
            className={clsx(
                "flex h-9 cursor-pointer items-center justify-between overflow-hidden rounded-md border-0 bg-transparent text-colorText transition-[width,padding,gap] duration-300 ease-in-out",
                "hover:bg-colorFillTertiary disabled:cursor-default disabled:opacity-60",
                collapsed ? "!w-8 gap-0 !p-1" : "w-full gap-2 px-1.5 py-3",
                className,
            )}
            disabled={disabled}
            {...buttonProps}
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
                        "max-w-[150px] overflow-hidden truncate transition-[max-width,opacity] duration-300 ease-in-out",
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
        </button>
    )
}
