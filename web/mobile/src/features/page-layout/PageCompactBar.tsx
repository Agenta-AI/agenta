import type {ReactNode} from "react"

import type {SidebarScope} from "@agenta/navigation"

import {NavDrawer} from "../nav/NavDrawer"

import {PAGE_GUTTERS, pageColumn, type PageWidth} from "./pageFrame"

/**
 * The one bar at the top of a compact or medium window: the menu on the left, the page actions
 * on the right. Hidden on an expanded window, where the docked sidebar and the title row take over.
 */
export const PageCompactBar = ({
    workspaceId,
    projectId,
    scope,
    actions,
    width,
}: {
    workspaceId: string
    projectId: string
    scope?: SidebarScope
    actions?: ReactNode
    /** The page's column, so the menu and the actions sit on the content's edges. */
    width?: PageWidth
}) => (
    <div className={`shrink-0 bg-muted lg:hidden ${PAGE_GUTTERS}`}>
        <div className={`flex h-header items-center gap-1 ${pageColumn(width)}`}>
            {/* -ml-1.5 puts the menu glyph on the content's left edge. */}
            <span className="-ml-1.5 inline-flex">
                <NavDrawer workspaceId={workspaceId} projectId={projectId} scope={scope} />
            </span>
            <span className="flex-1" />
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
    </div>
)
