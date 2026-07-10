/**
 * RailField
 *
 * One `[label column │ content]` row in the drawer's shared rail rhythm: a fixed 116px label column
 * (padding counted inside via `box-border`, so its separator lines up with the section rails) and a
 * content panel split off by a left border. Matches the "Exposed as" field and `SectionRail` content
 * edge, so stacked fields in a detail panel share one vertical separator.
 *
 * The content is capped at `max-w-prose` so inputs in a section panel keep a readable width instead
 * of stretching the full drawer. Styling uses antd semantic tokens (`--ag-color*`) only — dark-safe.
 */
import type {ReactNode} from "react"

import {Info} from "@phosphor-icons/react"
import {Tooltip} from "antd"

export interface RailFieldProps {
    label: ReactNode
    /** Vertical alignment of the label against the content. @default "top" */
    align?: "top" | "center"
    children: ReactNode
}

/**
 * A rail-field label with a trailing info tooltip. Keeps each knob's help text without a separate
 * description line, so rail rows stay one field per row (used by the sandbox/Claude permission forms).
 */
export const railInfoLabel = (label: ReactNode, hint: ReactNode): ReactNode => (
    <span className="inline-flex items-center gap-1">
        {label}
        <Tooltip title={hint}>
            <Info size={13} className="shrink-0 text-[var(--ag-colorTextTertiary)]" />
        </Tooltip>
    </span>
)

export function RailField({label, align = "top", children}: RailFieldProps) {
    return (
        <div className="flex gap-3">
            <div
                className={`box-border w-[116px] shrink-0 px-2.5 text-xs text-[var(--ag-colorTextSecondary)] ${
                    align === "center" ? "self-center" : "pt-1.5"
                }`}
            >
                {label}
            </div>
            <div className="flex min-w-0 max-w-prose flex-1 flex-col border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                {children}
            </div>
        </div>
    )
}
