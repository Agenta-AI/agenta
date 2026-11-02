/** One subscription row under its provider group: provider icon + status, "⋯" actions (run included). */
import {useState, type ReactNode} from "react"

import {
    DropdownMenuItem,
    DropdownMenuSeparator,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {Play} from "@phosphor-icons/react"

import {EventSourcePicker} from "../../../gatewayTrigger/drawers/shared/EventSourcePicker"
import {ProviderLogo} from "../sectionGroups"

import {TriggerActionsMenu} from "./TriggerActionsMenu"
import {useSubscriptionRun} from "./useSubscriptionRun"

/** A subscription rendered as a child under its provider group: icon box + status dot + actions. */
export function SubscriptionChildRow({
    logo,
    primary,
    primaryMuted,
    secondary,
    active,
    disabled,
    subscriptionId,
    runLabel,
    eventKey,
    playgroundEntityId,
    runDisabled,
    onOpen,
    menu,
    menuOpen,
    menuContainer,
}: {
    logo?: string | null
    primary: string
    primaryMuted?: boolean
    secondary?: string
    active: boolean
    disabled?: boolean
    subscriptionId: string
    /** Human label for the event source ("Message reaction added"), used in run previews. */
    runLabel: string
    eventKey?: string
    playgroundEntityId: string | null
    runDisabled?: boolean
    onOpen: () => void
    /** Composed "⋯" menu body (`DropdownMenuItem` JSX); the run action is prepended here. */
    menu: ReactNode
    /** Force the "⋯" menu open (forced-open parity stories). */
    menuOpen?: boolean
    /** Portal target for the "⋯" menu; defaults to document.body. */
    menuContainer?: HTMLElement | null
}) {
    const open = disabled ? undefined : onOpen
    const [runOpen, setRunOpen] = useState(false)
    const {recent, refresh, waitForEvent, run} = useSubscriptionRun({
        subscriptionId,
        label: runLabel,
        eventKey,
        playgroundEntityId,
    })

    // The run action lives in the "⋯" menu; selecting it opens the event picker anchored below.
    const composedMenu = (
        <>
            <DropdownMenuItem
                disabled={runDisabled}
                onSelect={() => {
                    void refresh()
                    setRunOpen(true)
                }}
            >
                <Play size={16} />
                Run now
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {menu}
        </>
    )

    return (
        <TooltipProvider>
            {/* Same split as TriggerRow: the `role="button"` region is a SIBLING of the ⋯ menu,
                never its ancestor (axe nested-interactive). */}
            <div
                className={`group flex items-center gap-2.5 rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-surface-section-content)] px-3 py-2 transition-colors ${
                    disabled
                        ? "cursor-default"
                        : "cursor-pointer hover:border-[var(--ag-colorBorder)]"
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
                            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]">
                                <ProviderLogo logo={logo} size={16} />
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
                        <div
                            className={`truncate text-xs font-normal ${
                                primaryMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                            }`}
                        >
                            {primary}
                        </div>
                        {secondary ? (
                            <div className="truncate text-xs leading-snug text-[var(--ag-colorTextTertiary)]">
                                {secondary}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1" role="presentation">
                    {runOpen ? (
                        <EventSourcePicker
                            defaultOpen
                            placement="bottomRight"
                            // Focusable and named, not an aria-hidden span: Radix restores focus
                            // by calling .focus() on the trigger, which a hidden span can't take.
                            trigger={
                                <button type="button" className="sr-only" aria-label="Event source">
                                    Event source
                                </button>
                            }
                            recentEvents={recent}
                            onPick={(event) => {
                                run(event)
                                setRunOpen(false)
                            }}
                            onWaitForEvent={waitForEvent}
                            onOpenChange={(next) => {
                                if (!next) setRunOpen(false)
                            }}
                            waitHint="trigger it from the app now"
                        />
                    ) : null}
                    <TriggerActionsMenu
                        menu={composedMenu}
                        open={menuOpen}
                        container={menuContainer}
                    />
                </div>
            </div>
        </TooltipProvider>
    )
}
