import type {MouseEvent, ReactNode} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {SimpleTooltip} from "@agenta/ui/composed"
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
    ariaLabel,
}: WorkflowPickerViewProps) => {
    const t = useT(navigationCatalog)
    // Pick here: the prevented default also stops Radix from calling the item's onSelect.
    const handleLinkClick = (event: MouseEvent, key: string) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            event.stopPropagation()
            onOpenChange(false)
            return
        }
        event.preventDefault()
        onOpenChange(false)
        onSelect(key)
    }

    const trigger = (
        <DropdownMenuTrigger asChild>
            <button
                type="button"
                aria-label={ariaLabel ?? t("navigation.items.switchWorkflow")}
                className={clsx(
                    "flex cursor-pointer items-center justify-between overflow-hidden rounded-md border-0 bg-transparent text-foreground transition-[width,height,padding,gap] duration-[var(--duration-slow)] ease-[var(--ease-in-out)] hover:bg-accent focus-ring",
                    // A rail row: 28px, its Mark on the icon line (ALIGN-02).
                    collapsed
                        ? "size-row-dense justify-center gap-0 p-0"
                        : "h-row-dense w-full gap-2 px-2",
                )}
            >
                {triggerContent}
                <span
                    className={clsx(
                        "flex shrink-0 items-center overflow-hidden transition-[width,opacity] duration-[var(--duration-slow)] ease-[var(--ease-in-out)]",
                        collapsed ? "w-0 opacity-0" : "w-3 opacity-100",
                    )}
                    aria-hidden={collapsed}
                >
                    <CaretDown
                        size={12}
                        className="ag-caret text-muted-foreground"
                        data-open={open || undefined}
                    />
                </span>
            </button>
        </DropdownMenuTrigger>
    )

    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
            {collapsed ? (
                // Icon only when collapsed: the name moves to a tooltip (KIT-03).
                <SimpleTooltip
                    title={ariaLabel ?? t("navigation.items.switchWorkflow")}
                    side="right"
                >
                    <span className="inline-flex">{trigger}</span>
                </SimpleTooltip>
            ) : (
                trigger
            )}
            <DropdownMenuContent
                side="bottom"
                align={collapsed ? "start" : "end"}
                className="max-h-80 min-w-popover-sm overflow-y-auto"
            >
                {entries.map((entry) => (
                    <DropdownMenuItem
                        key={entry.key}
                        asChild={Boolean(entry.href)}
                        // A link entry picks in its own click handler; a modified click opens a tab.
                        onSelect={
                            entry.href
                                ? (event) => event.preventDefault()
                                : () => onSelect(entry.key)
                        }
                    >
                        {entry.href ? (
                            <Link
                                className="block w-full !text-inherit no-underline hover:!text-inherit"
                                href={entry.href}
                                onClick={(event) => handleLinkClick(event, entry.key)}
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
