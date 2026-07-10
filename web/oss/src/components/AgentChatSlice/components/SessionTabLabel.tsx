import {useState} from "react"

import {Input} from "antd"

/**
 * A session tab's label. Double-click to rename inline (commit on Enter/blur). While editing,
 * the input owns its own pointer + keyboard events (stopped from bubbling) so the surrounding
 * tab's activation handler never sees them — otherwise Space couldn't be typed into a name and
 * Enter would also switch tabs. `className` styles the resting display span (the tag passes
 * `truncate` so a long title clips with an ellipsis).
 */
const SessionTabLabel = ({
    label,
    onRename,
    className,
}: {
    label: string
    onRename: (next: string) => void
    className?: string
}) => {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(label)

    if (editing) {
        const commit = () => {
            setEditing(false)
            if (draft.trim() !== label) onRename(draft)
        }
        return (
            <Input
                autoFocus
                variant="borderless"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={commit}
                onBlur={commit}
                onFocus={(e) => e.target.select()}
                onClick={(e) => e.stopPropagation()}
                // Keep typing (Space/Enter) inside the rename input; don't let it reach the tab.
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        setDraft(label)
                        setEditing(false)
                    }
                    e.stopPropagation()
                }}
                // Quiet in-place editor sized to the label it replaces: fills the row (no fixed
                // width overflowing the chip), same 12px type, subtle inset well instead of
                // antd's bordered box + primary focus ring.
                className="!h-5 !w-full !min-w-0 flex-1 !rounded !border !border-solid !border-[var(--ag-surface-inset-border)] !bg-[var(--ag-surface-inset)] !px-1 !py-0 !text-xs !text-colorText !shadow-none"
            />
        )
    }

    return (
        <span
            className={className}
            onDoubleClick={() => {
                setDraft(label)
                setEditing(true)
            }}
        >
            {label}
        </span>
    )
}

export default SessionTabLabel
