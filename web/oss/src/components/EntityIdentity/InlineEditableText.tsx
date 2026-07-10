import {useState} from "react"

import {Input} from "antd"
import clsx from "clsx"

interface InlineEditableTextProps {
    value: string
    onCommit: (next: string) => void
    /** Styles the resting display span (callers pass `truncate`/width). */
    className?: string
}

/**
 * Text that becomes an inline input in place. Double-click to edit; Enter/blur commit, Escape
 * reverts. While editing, the input swallows its own pointer + keyboard events so a surrounding
 * tab/row activation handler never sees them.
 */
const InlineEditableText = ({value, onCommit, className}: InlineEditableTextProps) => {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value)

    if (editing) {
        const commit = () => {
            const next = draft.trim()
            setEditing(false)
            if (next && next !== value) onCommit(next)
        }
        return (
            <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={commit}
                onBlur={commit}
                onFocus={(e) => e.target.select()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        setDraft(value)
                        setEditing(false)
                    }
                    e.stopPropagation()
                }}
                className="!h-6 !w-full !px-1 !text-xs"
            />
        )
    }

    return (
        <span
            className={clsx("block min-w-0 truncate", className)}
            onDoubleClick={(e) => {
                e.stopPropagation()
                setDraft(value)
                setEditing(true)
            }}
        >
            {value}
        </span>
    )
}

export default InlineEditableText
