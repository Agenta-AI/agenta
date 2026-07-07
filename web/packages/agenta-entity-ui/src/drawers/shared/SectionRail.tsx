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

import {Button} from "antd"
import clsx from "clsx"

export interface SectionRailItem {
    value: string
    label: string
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
    children,
}: SectionRailProps) {
    return (
        <div className={clsx("flex gap-3", fill && "min-h-0 flex-1")}>
            <div className={`flex ${railWidth} shrink-0 flex-col gap-0.5`}>
                {items.map((item) => {
                    const active = item.value === value
                    return (
                        <Button
                            key={item.value}
                            type="text"
                            block
                            disabled={disabled}
                            onClick={() => onChange(item.value)}
                            className={`!h-8 !rounded-md !px-2.5 !text-xs transition-colors ${
                                item.count != null || item.status
                                    ? "!flex !items-center !justify-between"
                                    : "!justify-start"
                            } ${
                                active
                                    ? "!bg-[var(--ag-colorFillSecondary)] !font-semibold !text-[var(--ag-colorText)]"
                                    : "!text-[var(--ag-colorTextSecondary)] hover:!bg-[var(--ag-colorFillTertiary)] hover:!text-[var(--ag-colorText)]"
                            }`}
                        >
                            <span className="truncate">{item.label}</span>
                            {item.status ? (
                                <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                        item.status === "invalid"
                                            ? "bg-[var(--ag-colorError)]"
                                            : "bg-[var(--ag-colorWarning)]"
                                    }`}
                                />
                            ) : item.count != null ? (
                                <span className="text-[10px] opacity-70">{item.count}</span>
                            ) : null}
                        </Button>
                    )
                })}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-0 border-l border-solid border-[var(--ag-colorBorder)] pl-4">
                {children}
            </div>
        </div>
    )
}
