import {useCallback, useImperativeHandle, useState, type Ref} from "react"

import {Input} from "@agenta/ui/ui"

export interface SessionTabLabelHandle {
    /** Enter rename mode programmatically (e.g. from a tab's pencil action). */
    startEditing: () => void
}

/**
 * A session tab's label. Double-click (or `ref.startEditing()`) to rename inline (commit on
 * Enter/blur). While editing, the input owns its own pointer + keyboard events (stopped from
 * bubbling) so the surrounding tab's activation handler never sees them — otherwise Space couldn't
 * be typed into a name and Enter would also switch tabs. `className`/`style` style the resting
 * display span (the tag clips long titles with a right-edge fade mask, never an ellipsis).
 */
const SessionTabLabel = ({
    label,
    onRename,
    className,
    style,
    title,
    ref,
    onEditingChange,
}: {
    label: string
    onRename: (next: string) => void
    className?: string
    /** Styles the resting span (the tag passes its fade mask here). */
    style?: React.CSSProperties
    /** Hover text for the resting span — the tag spells out its truncated name and shortcut. */
    title?: string
    ref?: Ref<SessionTabLabelHandle>
    /** Fires on enter/exit of rename mode so the parent can hide its hover actions meanwhile. */
    onEditingChange?: (editing: boolean) => void
}) => {
    const [editing, setEditingState] = useState(false)
    const [draft, setDraft] = useState(label)

    const setEditing = useCallback(
        (next: boolean) => {
            setEditingState(next)
            onEditingChange?.(next)
        },
        [onEditingChange],
    )
    const startEditing = useCallback(() => {
        setDraft(label)
        setEditing(true)
    }, [label, setEditing])
    useImperativeHandle(ref, () => ({startEditing}), [startEditing])

    if (editing) {
        const commit = () => {
            setEditing(false)
            if (draft.trim() !== label) onRename(draft)
        }
        return (
            <Input
                autoFocus
                variant="ghost"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onFocus={(e) => e.target.select()}
                onClick={(e) => e.stopPropagation()}
                // Keep typing (Space/Enter) inside the rename input; don't let it reach the tab.
                onKeyDown={(e) => {
                    if (e.key === "Enter") commit()
                    if (e.key === "Escape") {
                        setDraft(label)
                        setEditing(false)
                    }
                    e.stopPropagation()
                }}
                // Quiet in-place editor sized to the label it replaces: fills the row (no fixed
                // width overflowing the chip), same 12px type, subtle inset well instead of
                // antd's bordered box + primary focus ring. h-6 is the tallest that still fits
                // inside the h-7 tab chip.
                className="h-6 w-full min-w-0 flex-1 rounded border border-solid border-[var(--ag-surface-inset-border)] bg-[var(--ag-surface-inset)] px-1.5 py-0 text-xs text-colorText shadow-none"
            />
        )
    }

    return (
        <span className={className} style={style} title={title} onDoubleClick={startEditing}>
            {label}
        </span>
    )
}

export default SessionTabLabel
