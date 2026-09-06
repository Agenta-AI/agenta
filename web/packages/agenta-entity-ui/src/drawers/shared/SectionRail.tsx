/**
 * SectionRail
 *
 * The drawer's consistent `[left rail | right content]` section-body layout: a narrow vertical
 * toggle list (antd text buttons, primary-tinted when active) beside a content panel separated by
 * a left border. Shared by the workflow-reference detail sections (Schema, Configuration) and the
 * `RunVersionField` Pinned/Deployed axis, so every rail in the drawer looks and behaves the same.
 *
 * Styling uses antd semantic tokens (`--ag-color*`) only — dark-safe.
 */
import {useState, type ReactNode} from "react"

import {Button} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import clsx from "clsx"

export interface SectionRailItem {
    value: string
    label: string
    /** Optional leading glyph, sized by the caller (14-15px matches the drawer rails). */
    icon?: ReactNode
    /** Optional trailing count (e.g. a schema's field count). */
    count?: number
    /**
     * Optional trailing status dot — flags an item that needs attention (e.g. a missing provider
     * key). `"warning"` is amber, `"invalid"` is red. Takes the trailing slot over `count`.
     */
    status?: "warning" | "invalid"
}

export interface SectionRailProps {
    items: SectionRailItem[]
    value: string
    onChange: (value: string) => void
    /** Rail column width. @default "w-[96px] sm:w-[116px]" */
    railWidth?: string
    /** Disable the rail toggles (e.g. a read-only revision). @default false */
    disabled?: boolean
    /**
     * Stretch to fill a bounded flex parent (`min-h-0 flex-1`) so the content panel can host an
     * internally-scrolling child. @default false (content-flow, natural height — the drawer case).
     */
    fill?: boolean
    /** Bleed the divider past the host's 16px vertical padding, onto its rules. @default false */
    bleed?: boolean
    /**
     * Phone: show one pane at a time (rail, then the picked section) instead of side by side.
     * Off by default — a short two-item axis reads better as a toggle. @default false
     */
    drillIn?: boolean
    /** What the phone back link calls the rail. @default "Sections" */
    listLabel?: string
    /** Right-hand content panel; separated from the rail by a left border. */
    children: ReactNode
}

export function SectionRail({
    items,
    value,
    onChange,
    railWidth = "w-[96px] sm:w-[116px]",
    disabled = false,
    fill = false,
    bleed = false,
    drillIn = false,
    listLabel = "Sections",
    children,
}: SectionRailProps) {
    // The rail opens, picking a section pushes its panel, a back link returns — side by side left
    // the panel a sliver on a phone.
    const [mobileView, setMobileView] = useState<"list" | "detail">("list")
    const showList = !drillIn || mobileView === "list"
    const showDetail = !drillIn || mobileView === "detail"
    return (
        <div className={clsx("flex gap-2", fill && "min-h-0 flex-1")}>
            <div
                className={clsx(
                    "flex flex-col gap-0.5 sm:shrink-0",
                    railWidth,
                    drillIn && (showList ? "max-sm:!w-full" : "max-sm:hidden"),
                )}
            >
                {items.map((item) => {
                    const active = item.value === value
                    return (
                        <Button
                            key={item.value}
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => {
                                onChange(item.value)
                                if (drillIn) setMobileView("detail")
                            }}
                            className={`h-8 w-full rounded-md px-2 text-xs transition-colors ${
                                item.count != null || item.status
                                    ? "flex items-center justify-between"
                                    : "justify-start"
                            } ${
                                // disabled: restated — the pre-migration `!` classes beat antd's
                                // disabled skin, so disabled rows keep their resting colors.
                                active
                                    ? "bg-[var(--ag-colorFillSecondary)] font-semibold text-[var(--ag-colorText)] disabled:bg-[var(--ag-colorFillSecondary)] disabled:text-[var(--ag-colorText)]"
                                    : "text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillTertiary)] hover:text-[var(--ag-colorText)] disabled:text-[var(--ag-colorTextSecondary)]"
                            }`}
                        >
                            <span className="flex min-w-0 items-center gap-1.5">
                                {item.icon ? (
                                    <span className="flex shrink-0 items-center opacity-75">
                                        {item.icon}
                                    </span>
                                ) : null}
                                <span className="truncate">{item.label}</span>
                            </span>
                            {item.status ? (
                                <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                        item.status === "invalid"
                                            ? "bg-[var(--ag-colorError)]"
                                            : "bg-[var(--ag-colorWarning)]"
                                    }`}
                                />
                            ) : item.count != null ? (
                                <span className="text-[12px] opacity-70">{item.count}</span>
                            ) : null}
                        </Button>
                    )
                })}
            </div>
            <div
                className={clsx(
                    "min-w-0 flex-1 flex-col gap-1.5 border-0 border-solid border-[var(--ag-colorBorder)] sm:border-l sm:pl-4",
                    bleed && "-my-4 py-4",
                    showDetail ? "flex" : "hidden sm:flex",
                )}
            >
                {drillIn ? (
                    <button
                        type="button"
                        onClick={() => setMobileView("list")}
                        className="flex shrink-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-xs text-[var(--ag-colorTextSecondary)] sm:hidden"
                    >
                        <ArrowLeft />
                        {listLabel}
                    </button>
                ) : null}
                {children}
            </div>
        </div>
    )
}
