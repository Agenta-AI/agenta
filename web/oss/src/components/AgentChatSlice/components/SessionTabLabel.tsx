import {useState} from "react"

import {Input} from "antd"

/**
 * A session tab's label. Double-click to rename inline (commit on Enter/blur). Clicks while
 * editing are stopped so they don't also switch tabs.
 */
const SessionTabLabel = ({label, onRename}: {label: string; onRename: (next: string) => void}) => {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(label)

    if (editing) {
        const commit = () => {
            setEditing(false)
            if (draft.trim() !== label) onRename(draft)
        }
        return (
            <Input
                size="small"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={commit}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                className="!w-28 !text-xs"
            />
        )
    }

    return (
        <span
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
