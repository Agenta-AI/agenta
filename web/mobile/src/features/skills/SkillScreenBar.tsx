import type {ReactNode} from "react"

import {NavDrawer} from "../nav/NavDrawer"

/**
 * A skill screen's top bar below `lg`: the drawer button, the way back, and a slot on the right
 * that the screen fills with its actions. It sits outside the scroller, so Save stays in reach.
 * From `lg` the sidebar is open, and the back link and actions live beside the title instead.
 */
export const SkillScreenBar = ({
    workspaceId,
    projectId,
    back,
    onSlot,
    className,
}: {
    workspaceId: string
    projectId: string
    back?: ReactNode
    /** Receives the right-hand element, for the screen's actions to portal into. */
    onSlot?: (element: HTMLDivElement | null) => void
    className?: string
}) => (
    <div
        className={`box-border flex min-h-14 shrink-0 items-center gap-1 px-4 py-2 lg:hidden ${className ?? ""}`}
    >
        {/* -ml-1.5: the glyph sits 6px inside its button, and the column edge is the glyph's. */}
        <span className="-ml-1.5 flex shrink-0">
            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
        </span>
        <span className="min-w-0 flex-1 truncate">{back}</span>
        <div ref={onSlot} className="flex shrink-0 items-center gap-1" />
    </div>
)
