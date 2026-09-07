/**
 * Desktop shell around the shared `QueuedMessagesDock` — the "what you have lined up" band for
 * messages typed while a turn was in flight. Sibling of `ApprovalDock`/`ConnectionDock` in form,
 * and it keeps its place ABOVE them: those are gates the run is blocked on, so they stay nearest
 * the composer, while this is a list the run drains by itself.
 *
 * The card is shared with /m; this file keeps only the desktop chrome — the open/close collapse,
 * the column width, and the latch that holds the last non-empty queue so the list is still there
 * to look at while the dock animates shut.
 */
import {memo, useRef} from "react"

import {QueuedMessagesDock, RevealCollapse} from "@agenta/chat/components"
import type {QueuedMessage} from "@agenta/chat/hooks"

interface AgentQueuedMessagesDockProps {
    queued: QueuedMessage[]
    /** The run is parked on the user, so the queue is held rather than merely waiting. */
    held: boolean
    onRemove: (id: string) => void
    onEdit: (message: QueuedMessage) => void
    onCancelEdit: () => void
    editingId: string | null
    className?: string
}

const AgentQueuedMessagesDock = ({
    queued,
    held,
    onRemove,
    onEdit,
    onCancelEdit,
    editingId,
    className,
}: AgentQueuedMessagesDockProps) => {
    const open = queued.length > 0
    // Latch the last non-empty queue: emptying it starts the collapse, and without this the rows
    // would vanish first and leave an empty box folding shut.
    const shownRef = useRef(queued)
    if (open) shownRef.current = queued

    return (
        <RevealCollapse open={open} className={className}>
            <QueuedMessagesDock
                className="mb-2"
                queued={shownRef.current}
                held={held}
                onRemove={onRemove}
                onEdit={onEdit}
                onCancelEdit={onCancelEdit}
                editingId={editingId}
            />
        </RevealCollapse>
    )
}

export default memo(AgentQueuedMessagesDock)
