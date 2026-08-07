/** One subscription row rendered under its provider group in the Triggers section. */
import {type ReactNode} from "react"

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"

import {TriggerActionsMenu} from "./TriggerActionsMenu"

/** A subscription rendered as a child under its provider group: dot + event + actions. */
export function SubscriptionChildRow({
    primary,
    primaryMuted,
    secondary,
    active,
    disabled,
    runSlot,
    onOpen,
    menu,
    menuOpen,
    menuContainer,
}: {
    primary: string
    primaryMuted?: boolean
    secondary?: string
    active: boolean
    disabled?: boolean
    /** The "Run in playground" affordance (an event-source picker), supplied by the parent. */
    runSlot: ReactNode
    onOpen: () => void
    /** Composed "⋯" menu body (`DropdownMenuItem` JSX), supplied by the container. */
    menu: ReactNode
    /** Force the "⋯" menu open (forced-open parity stories). */
    menuOpen?: boolean
    /** Portal target for the "⋯" menu; defaults to document.body. */
    menuContainer?: HTMLElement | null
}) {
    const open = disabled ? undefined : onOpen
    return (
        <TooltipProvider>
            {/* Same split as TriggerRow: the `role="button"` region is a SIBLING of the run +
                ⋯ controls, never their ancestor (axe nested-interactive). Geometry unchanged —
                the outer flex still supplies the gap-2.5 between the two groups. */}
            <div
                className={`group flex items-center gap-2.5 rounded px-2.5 py-1.5 transition-colors ${
                    disabled
                        ? "cursor-default"
                        : "cursor-pointer hover:bg-[var(--ag-colorFillSecondary)]"
                }`}
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
                            <span
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                    active
                                        ? "bg-[var(--ag-colorSuccess)]"
                                        : "bg-[var(--ag-colorTextQuaternary)]"
                                }`}
                            />
                        </TooltipTrigger>
                        <TooltipContent>{active ? "Active" : "Paused"}</TooltipContent>
                    </Tooltip>
                    <div className="min-w-0 flex-1">
                        <div
                            className={`truncate text-xs font-medium ${
                                primaryMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                            }`}
                        >
                            {primary}
                        </div>
                        {secondary ? (
                            <div className="truncate text-[11px] leading-snug text-[var(--ag-colorTextTertiary)]">
                                {secondary}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1" role="presentation">
                    {runSlot}
                    <TriggerActionsMenu menu={menu} open={menuOpen} container={menuContainer} />
                </div>
            </div>
        </TooltipProvider>
    )
}
