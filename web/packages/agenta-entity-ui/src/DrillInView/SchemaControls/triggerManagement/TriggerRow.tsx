/** The Triggers section's standalone trigger row (used for schedules). */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"

import {PHONE_LINE_CLASS, PHONE_NAME_CLASS, PHONE_ROW_CLASS, PhoneRowSwitch} from "./phoneRow"
import {TriggerActionsMenu} from "./TriggerActionsMenu"

/** A trigger row: leading status-dot icon, name, subtitle, ⋯ menu. */
export function TriggerRow({
    icon,
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
    icon: ReactNode
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
    const t = useT(triggersCatalog)
    // Read-only mode opens nothing: the row's target is an editable drawer.
    const open = disabled ? undefined : onOpen
    return (
        <TooltipProvider>
            {/* The clickable region is a SIBLING of the ⋯ menu, not its ancestor:
                `role="button"` forbids focusable descendants (axe nested-interactive). Same
                geometry — the outer flex keeps the gap-2.5 the children sit in. */}
            <div
                // White sheet on the expanded section's band, like the tool/skill item cards.
                className={
                    phone
                        ? `${PHONE_ROW_CLASS} ${disabled ? "cursor-default" : "cursor-pointer"}`
                        : `group flex items-center gap-2.5 rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-surface-section-content)] px-3 py-2 transition-colors ${disabled ? "cursor-default" : "cursor-pointer hover:border-[var(--ag-colorBorder)]"}`
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
                    className={`flex min-w-0 flex-1 items-center ${phone ? "gap-3 self-stretch" : "gap-2.5"}`}
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
                        <TooltipContent>
                            {active ? t("entityUi.triggers.active") : t("entityUi.triggers.paused")}
                        </TooltipContent>
                    </Tooltip>
                    <div className="min-w-0 flex-1">
                        <div
                            className={`${phone ? PHONE_NAME_CLASS : "truncate text-xs"} font-normal ${
                                nameMuted ? "italic text-[var(--ag-colorTextTertiary)]" : ""
                            }`}
                        >
                            {name}
                        </div>
                        <div
                            className={
                                phone
                                    ? PHONE_LINE_CLASS
                                    : "mt-0.5 truncate text-xs leading-snug text-[var(--ag-colorTextSecondary)]"
                            }
                        >
                            {subtitle}
                        </div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1" role="presentation">
                    {onToggle ? (
                        <PhoneRowSwitch name={name} active={active} onToggle={onToggle} />
                    ) : null}
                    <TriggerActionsMenu
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
