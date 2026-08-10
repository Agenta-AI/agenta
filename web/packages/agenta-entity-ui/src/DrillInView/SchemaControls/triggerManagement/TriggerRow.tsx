/** The Triggers section's standalone trigger row (used for schedules). */
import {type ReactNode} from "react"

import {Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {CaretRight, Flask} from "@phosphor-icons/react"

import {TriggerActionsMenu} from "./TriggerActionsMenu"

/** A trigger row: leading status-dot icon, bold name + chevron, subtitle, run + ⋯ menu. */
export function TriggerRow({
    icon,
    name,
    nameMuted,
    chip,
    subtitle,
    active,
    disabled,
    runDisabled,
    onRun,
    onOpen,
    menu,
    menuOpen,
    menuContainer,
}: {
    icon: ReactNode
    name: string
    nameMuted?: boolean
    chip?: ReactNode
    subtitle: string
    active: boolean
    disabled?: boolean
    runDisabled?: boolean
    onRun: () => void
    onOpen: () => void
    /** Composed "⋯" menu body (`DropdownMenuItem` JSX), supplied by the container. */
    menu: ReactNode
    /** Force the "⋯" menu open (forced-open parity stories). */
    menuOpen?: boolean
    /** Portal target for the "⋯" menu; defaults to document.body. */
    menuContainer?: HTMLElement | null
}) {
    // Read-only mode opens nothing: the row's target is an editable drawer.
    const open = disabled ? undefined : onOpen
    return (
        <TooltipProvider>
            {/* The clickable region is a SIBLING of the action buttons, not their ancestor:
                `role="button"` forbids focusable descendants (axe nested-interactive), and the
                row hosts a run button + a ⋯ menu. Same geometry — the outer flex keeps the
                gap-2.5 the three children used to sit in. */}
            <div
                className={`group flex items-center gap-2.5 rounded border border-solid border-[var(--ag-colorBorderSecondary)] px-3 py-2 transition-colors ${disabled ? "cursor-default" : "cursor-pointer hover:border-[var(--ag-colorBorder)]"}`}
            >
                <div
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-disabled={disabled || undefined}
                    onClick={open}
                    onKeyDown={(e) => {
                        if (!open) return
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            open()
                        }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5"
                >
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]">
                                {icon}
                                <span
                                    className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-solid border-[var(--ag-colorBgContainer)] ${
                                        active
                                            ? "bg-[var(--ag-colorSuccess)]"
                                            : "bg-[var(--ag-colorTextQuaternary)]"
                                    }`}
                                />
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>{active ? "Active" : "Paused"}</TooltipContent>
                    </Tooltip>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span
                                className={`truncate text-xs font-medium ${
                                    nameMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                                }`}
                            >
                                {name}
                            </span>
                            <CaretRight
                                size={12}
                                className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                            />
                            {chip ? (
                                <span className="ml-0.5 max-w-[170px] shrink-0 truncate rounded bg-[var(--ag-colorFillSecondary)] px-1.5 py-0.5 text-[10px] text-[var(--ag-colorTextSecondary)]">
                                    {chip}
                                </span>
                            ) : null}
                        </div>
                        <div className="mt-0.5 line-clamp-2 max-w-prose text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                            {subtitle}
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1" role="presentation">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Run in playground"
                                disabled={runDisabled}
                                onClick={onRun}
                            >
                                <Flask size={16} />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Run in playground</TooltipContent>
                    </Tooltip>
                    <TriggerActionsMenu menu={menu} open={menuOpen} container={menuContainer} />
                </div>
            </div>
        </TooltipProvider>
    )
}
