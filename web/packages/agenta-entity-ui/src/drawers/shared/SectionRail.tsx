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
import type {ReactNode} from "react"

import {Button} from "@agenta/ui/ui"
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
    /** Rail column width. @default "w-[116px]" */
    railWidth?: string
    /** Disable the rail toggles (e.g. a read-only revision). @default false */
    disabled?: boolean
    /**
     * Stretch to fill a bounded flex parent (`min-h-0 flex-1`) so the content panel can host an
     * internally-scrolling child. @default false (content-flow, natural height — the drawer case).
     */
    fill?: boolean
    /**
     * Run the divider past the host's 16px top/bottom body padding so it meets the drawer's header
     * and footer rules instead of floating between them. The padding is restored inside the panel,
     * so the content sits where it did. @default false
     */
    bleed?: boolean
    /** Right-hand content panel; separated from the rail by a left border. */
    children: ReactNode
}

export function SectionRail({
    items,
    value,
    onChange,
    railWidth = "w-[116px]",
    disabled = false,
    fill = false,
    bleed = false,
    children,
}: SectionRailProps) {
    return (
        <div className={clsx("flex gap-2", fill && "min-h-0 flex-1")}>
            <div className={`flex ${railWidth} shrink-0 flex-col gap-0.5`}>
                {items.map((item) => {
                    const active = item.value === value
                    return (
                        <Button
                            key={item.value}
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => onChange(item.value)}
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
                    "flex min-w-0 flex-1 flex-col gap-1.5 border-0 border-l border-solid border-[var(--ag-colorBorder)] pl-4",
                    bleed && "-my-4 py-4",
                )}
            >
                {children}
            </div>
        </div>
    )
}
