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

export interface SectionRailItem {
    value: string
    label: string
    /** Optional trailing count (e.g. a schema's field count). */
    count?: number
}

export interface SectionRailProps {
    items: SectionRailItem[]
    value: string
    onChange: (value: string) => void
    /** Rail column width. @default "w-[116px]" */
    railWidth?: string
    /** Right-hand content panel; separated from the rail by a left border. */
    children: ReactNode
}

export function SectionRail({
    items,
    value,
    onChange,
    railWidth = "w-[116px]",
    children,
}: SectionRailProps) {
    return (
        <div className="flex gap-3">
            <div className={`flex ${railWidth} shrink-0 flex-col gap-0.5`}>
                {items.map((item) => {
                    const active = item.value === value
                    return (
                        <Button
                            key={item.value}
                            type="text"
                            block
                            onClick={() => onChange(item.value)}
                            className={`!h-8 !px-2.5 !text-xs ${
                                item.count != null
                                    ? "!flex !items-center !justify-between"
                                    : "!justify-start"
                            } ${
                                active
                                    ? "!bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]"
                                    : "!text-[var(--ag-colorTextSecondary)]"
                            }`}
                        >
                            <span className="truncate">{item.label}</span>
                            {item.count != null ? (
                                <span className="text-[10px] opacity-70">{item.count}</span>
                            ) : null}
                        </Button>
                    )
                })}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                {children}
            </div>
        </div>
    )
}
