import type {MouseEvent, ReactNode} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"
import clsx from "clsx"
import Link from "next/link"

export interface WorkflowPickerEntry {
    key: string
    /** Real anchor per row so middle-click / ctrl+click open a new tab. */
    href: string | null
    content: ReactNode
}

export interface WorkflowPickerViewProps {
    collapsed: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The current workflow's identity block (the app renders its own icon/name/tag). */
    triggerContent: ReactNode
    entries: WorkflowPickerEntry[]
    onSelect: (key: string) => void
    ariaLabel?: string
}

/** The workflow scope's switcher: identity trigger + a scrollable Radix menu of workflows. */
export const WorkflowPickerView = ({
    collapsed,
    open,
    onOpenChange,
    triggerContent,
    entries,
    onSelect,
    ariaLabel = "Switch workflow",
}: WorkflowPickerViewProps) => {
    // Plain left clicks stay on the SPA path (the item's onSelect); modified clicks
    // fall through to the anchor so the browser opens a tab.
    const handleLinkClick = (event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            event.stopPropagation()
            onOpenChange(false)
            return
        }
        event.preventDefault()
    }

    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={ariaLabel}
                    className={clsx(
                        "flex cursor-pointer items-center justify-between overflow-hidden rounded-md border-0 bg-transparent text-colorText transition-[width,height,padding,gap,border-color] duration-300 ease-in-out hover:bg-colorFillTertiary",
                        // No border when expanded: the header row it sits in is already
                        // framed by the rail's own line, so a box inside a box reads wrong.
                        collapsed ? "!h-8 !w-8 gap-0 !p-1" : "h-full w-full gap-2 pl-1.5 pr-2",
                    )}
                >
                    {triggerContent}
                    <span
                        className={clsx(
                            "flex shrink-0 items-center overflow-hidden transition-[width,opacity] duration-300 ease-in-out",
                            collapsed ? "w-0 opacity-0" : "w-3.5 opacity-100",
                        )}
                        aria-hidden={collapsed}
                    >
                        <CaretDown
                            size={14}
                            className={clsx("transition-transform", open && "rotate-180")}
                        />
                    </span>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="bottom"
                align={collapsed ? "start" : "end"}
                className="z-[2000] max-h-80 min-w-[220px] overflow-y-auto p-2"
            >
                {entries.map((entry) => (
                    <DropdownMenuItem
                        key={entry.key}
                        className="px-2"
                        asChild={Boolean(entry.href)}
                        onSelect={() => onSelect(entry.key)}
                    >
                        {entry.href ? (
                            <Link
                                className="block w-full !text-inherit no-underline hover:!text-inherit"
                                href={entry.href}
                                onClick={handleLinkClick}
                            >
                                {entry.content}
                            </Link>
                        ) : (
                            <span className="block w-full">{entry.content}</span>
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
