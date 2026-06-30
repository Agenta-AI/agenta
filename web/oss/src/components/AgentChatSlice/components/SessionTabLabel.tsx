import {useState} from "react"

import {Input} from "antd"

/**
 * A session tab's label. Double-click to rename inline (commit on Enter/blur). Clicks while
 * editing are stopped so they don't also switch tabs. `className` styles the resting display
 * span (the tag passes `truncate` so a long title clips with an ellipsis).
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
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={commit}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                className="!h-6 !w-28 !px-1 !text-xs"
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
