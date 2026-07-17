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

import {ArrowCounterClockwise, Info} from "@phosphor-icons/react"
import {Button, Popover, Tooltip} from "antd"

import {useChangedDetail, useChangedPath, useRevertPath} from "./ChangedPathsContext"
import {useIsPathVisible} from "./FocusPathsContext"

export interface RailFieldProps {
    label: ReactNode
    /** Vertical alignment of the label against the content. @default "top" */
    align?: "top" | "center"
    /**
     * This row's config dot-path (e.g. `runner.permissions.default`). When it has an uncommitted
     * change — per the surrounding {@link ChangedPathsProvider} — the label marks itself and opens
     * the change's detail, so a surface shows WHICH property changed rather than just that
     * something did. Opt-in: without a path (or a provider) the row renders exactly as before.
     */
    path?: string
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

// Unpack the classifier's JSON.stringify'd scalar back to what the field shows (one rule per line),
// naming the empty cases rather than printing wire syntax like `[]`.
export function formatCommitted(before: string | undefined): {text: string; muted: boolean} {
    if (before === undefined) return {text: "Not set", muted: true}
    let value: unknown = before
    try {
        value = JSON.parse(before)
    } catch {
        // A plain string the classifier passed through as-is.
    }
    if (Array.isArray(value)) {
        return value.length
            ? {text: value.map((entry) => String(entry)).join("\n"), muted: false}
            : {text: "Empty", muted: true}
    }
    if (value && typeof value === "object") {
        return Object.keys(value).length
            ? {text: JSON.stringify(value, null, 2), muted: false}
            : {text: "Empty", muted: true}
    }
    const text = String(value ?? "")
    return text.trim() ? {text, muted: false} : {text: "Empty", muted: true}
}

// The committed value ("changed from what?") and its undo on one surface: the value shown IS the
// revert's confirmation, so no separate confirm step is needed.
function ChangedDetail({
    before,
    onRevert,
}: {
    before: string | undefined
    onRevert: (() => void) | null
}) {
    const {text, muted} = formatCommitted(before)
    return (
        <div className="flex w-[200px] flex-col gap-2">
            <div className="text-[11px] uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                Committed value
            </div>
            <div
                className={`max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-2 py-1 text-xs ${
                    muted
                        ? "italic text-[var(--ag-colorTextTertiary)]"
                        : "font-mono text-[var(--ag-colorText)]"
                }`}
            >
                {text}
            </div>
            {onRevert ? (
                <Button
                    icon={<ArrowCounterClockwise size={13} />}
                    onClick={onRevert}
                    block
                    className="!text-xs"
                >
                    {before === undefined ? "Remove change" : "Restore"}
                </Button>
            ) : null}
        </div>
    )
}

export function RailField({label, align = "top", path, children}: RailFieldProps) {
    const changed = useChangedPath(path)
    const detail = useChangedDetail(path)
    const revert = useRevertPath(path)
    // Focus filter (see FocusPathsContext): each row self-filters on its own `path`.
    const visible = useIsPathVisible(path)
    if (!visible) return null
    return (
        <div className="flex gap-3">
            <div
                className={`box-border w-[116px] shrink-0 px-2.5 text-xs ${
                    align === "center" ? "self-center" : "pt-1.5"
                } ${changed ? "text-[var(--ag-colorText)]" : "text-[var(--ag-colorTextSecondary)]"}`}
            >
                {/* The label carries the change via emphasis (colorTextSecondary → colorText) plus a
                    colorInfo dotted underline — no marker glyph, so changed and unchanged rows share
                    the same box. */}
                {changed ? (
                    <Popover
                        trigger="click"
                        placement="topLeft"
                        content={<ChangedDetail before={detail?.before} onRevert={revert} />}
                    >
                        <span className="cursor-pointer underline decoration-[var(--ag-colorInfo)] decoration-dotted underline-offset-4">
                            {label}
                        </span>
                    </Popover>
                ) : (
                    label
                )}
            </div>
            <div className="flex min-w-0 max-w-prose flex-1 flex-col border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                {children}
            </div>
        </div>
    )
}
