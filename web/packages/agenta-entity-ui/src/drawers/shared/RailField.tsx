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

/**
 * The committed value, as a reader recognises it rather than as it travels.
 *
 * The classifier stores scalars through `JSON.stringify` (`commitDiff/classify.ts`), which is right
 * for comparing but wrong for showing: it renders an empty list as `[]` and a rule list as
 * `["Terminal","Write"]` — wire syntax the control itself never displays. Unpack it back to what the
 * field shows (one rule per line, matching the textarea), and name the empty cases instead of
 * printing punctuation at someone.
 */
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

/**
 * What an uncommitted property changed FROM, and the undo for it.
 *
 * Reverting and explaining are one surface on purpose: "changed from what?" and "are you sure?" have
 * the same answer — the committed value. Showing it here means the revert is confirmed by an
 * explicit second click against the value it will restore, so it needs no separate confirm step that
 * would only repeat the property's name back at the reader.
 */
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
    // Focus filter (see FocusPathsContext): a surface can narrow itself to the properties that
    // matter right now, and each row decides for itself using the `path` it already declares —
    // so "show only what changed" reuses these very controls instead of a parallel rendering.
    const visible = useIsPathVisible(path)
    if (!visible) return null
    return (
        <div className="flex gap-3">
            <div
                className={`box-border w-[116px] shrink-0 px-2.5 text-xs ${
                    align === "center" ? "self-center" : "pt-1.5"
                } ${changed ? "text-[var(--ag-colorText)]" : "text-[var(--ag-colorTextSecondary)]"}`}
            >
                {/* The LABEL carries the change. No marker glyph: a dot next to the text has to sit
                    somewhere, and wherever that is it either shifts the label (in flow) or floats
                    detached from it (absolute) — restyling text costs no space, so a changed row and
                    an unchanged one occupy exactly the same box.

                    EMPHASIS, not hue: the label steps up from `colorTextSecondary` to full-strength
                    `colorText`, so it reads as changed by standing out from its muted siblings. The
                    draft tone (`colorInfo`) appears only as the dotted underline — enough to tie the
                    row to the section's draft dot and to say "there's more behind this", without
                    setting a whole word in a saturated accent that fights the dark surface. */}
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
