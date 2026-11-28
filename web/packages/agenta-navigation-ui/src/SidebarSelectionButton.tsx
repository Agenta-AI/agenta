import type {ButtonHTMLAttributes} from "react"

import {IconTile} from "@agenta/ui/composed"
import {CaretDown} from "@phosphor-icons/react"
import clsx from "clsx"

import {ROW_HEIGHT} from "./rowStyles"

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

// Width, padding and gap follow the rail's own width transition.
const MOTION =
    "duration-[var(--duration-slow)] ease-[var(--ease-in-out)] motion-reduce:transition-none"

/**
 * The rail's selection trigger (org/project, workflow): a rail row with the workspace Mark, the
 * label and a caret, collapsing to the Mark alone with the rail.
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
    const letter = displayLabel.trim().charAt(0).toUpperCase()

    return (
        <button
            type="button"
            className={clsx(
                // [font-family:inherit]: preflight is off, so a bare <button> renders Arial.
                "flex cursor-pointer items-center justify-between overflow-hidden rounded-md border-0 bg-transparent [font-family:inherit] text-foreground outline-none focus-ring transition-[width,padding,gap]",
                ROW_HEIGHT,
                MOTION,
                "hover:bg-accent disabled:cursor-default disabled:opacity-50",
                collapsed ? "!w-7 justify-center gap-0 !px-0" : "w-full gap-2 px-2",
                className,
            )}
            disabled={disabled}
            {...buttonProps}
        >
            <div
                className={clsx(
                    "flex min-w-0 items-center transition-[gap]",
                    MOTION,
                    collapsed ? "gap-0" : "gap-2",
                )}
            >
                <IconTile size={16} tone="brand">
                    {letter}
                </IconTile>
                <span
                    className={clsx(
                        "max-w-40 overflow-hidden truncate transition-[max-width,opacity]",
                        MOTION,
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
                    "flex shrink-0 items-center overflow-hidden text-muted-foreground transition-[width,opacity]",
                    MOTION,
                    !collapsed && showCaret ? "w-4 opacity-100" : "w-0 opacity-0",
                )}
                aria-hidden={collapsed || !showCaret}
            >
                <CaretDown size={16} className="ag-caret" data-open={isOpen} />
            </span>
        </button>
    )
}
