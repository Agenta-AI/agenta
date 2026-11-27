/** The Triggers section's standalone trigger row (used for schedules). */
import {type ReactNode} from "react"

import {TooltipProvider} from "@agenta/ui/ui"

import {PHONE_LINE_CLASS, PHONE_NAME_CLASS, PHONE_ROW_CLASS, PhoneRowSwitch} from "./phoneRow"
import {LINE_CLASS, NAME_CLASS, ROW_CLASS, ROW_LEAD_GAP, RowStatusDot} from "./rowParts"
import {TriggerActionsMenu} from "./TriggerActionsMenu"

/** A trigger row: the tile, name, line, the status dot (or a phone's switch) and the "⋯" menu. */
export function TriggerRow({
    tile,
    name,
    nameMuted,
    subtitle,
    active,
    disabled,
    onOpen,
    menu,
    menuOpen,
    menuContainer,
    phone,
    onToggle,
}: {
    /** The 24 px Mark before the name (`RowTile`). */
    tile: ReactNode
    name: string
    nameMuted?: boolean
    subtitle: string
    active: boolean
    disabled?: boolean
    onOpen: () => void
    /** Composed "⋯" menu body (`DropdownMenuItem` JSX), supplied by the container. */
    menu: ReactNode
    /** Force the "⋯" menu open (forced-open parity stories). */
    menuOpen?: boolean
    /** Portal target for the "⋯" menu; defaults to document.body. */
    menuContainer?: HTMLElement | null
    /** The phone shape (M10): a flat row, the line wraps, 44 px controls. */
    phone?: boolean
    /** Phone only: the row's switch turns the automation on or off. Absent, no switch. */
    onToggle?: (next: boolean) => void
}) {
    // Read-only mode opens nothing: the row's target is an editable drawer.
    const open = disabled ? undefined : onOpen
    return (
        <TooltipProvider>
            {/* The clickable region is a SIBLING of the ⋯ menu, not its ancestor:
                `role="button"` forbids focusable descendants (axe nested-interactive). */}
            <div
                className={
                    phone
                        ? `${PHONE_ROW_CLASS} ${disabled ? "cursor-default" : "cursor-pointer"}`
                        : `${ROW_CLASS} ${disabled ? "cursor-default" : "cursor-pointer hover:border-border"}`
                }
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
                    className={`focus-ring flex min-w-0 flex-1 items-center rounded-sm ${phone ? "gap-3 self-stretch" : ROW_LEAD_GAP}`}
                >
                    {tile}
                    <div className="min-w-0 flex-1">
                        <div
                            className={`${phone ? PHONE_NAME_CLASS : NAME_CLASS} ${
                                nameMuted ? "italic text-muted-foreground" : ""
                            }`}
                        >
                            {name}
                        </div>
                        <div className={phone ? PHONE_LINE_CLASS : LINE_CLASS}>{subtitle}</div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1" role="presentation">
                    {onToggle ? (
                        <PhoneRowSwitch name={name} active={active} onToggle={onToggle} />
                    ) : (
                        <RowStatusDot active={active} />
                    )}
                    <TriggerActionsMenu
                        name={name}
                        menu={menu}
                        open={menuOpen}
                        container={menuContainer}
                        phone={phone}
                    />
                </div>
            </div>
        </TooltipProvider>
    )
}
