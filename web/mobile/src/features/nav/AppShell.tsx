import type {ReactNode} from "react"

import {NavRail} from "./NavRail"

/**
 * The viewport-aware app frame: a persistent sidebar at lg+ beside the screen, nothing below
 * lg (where screens carry the NavDrawer hamburger in their own headers). Screens wrap their
 * ScreenScaffold in this — the scaffold's `h-dvh` column becomes the flex-1 main pane.
 */
export const AppShell = ({
    workspaceId,
    projectId,
    children,
}: {
    workspaceId: string
    projectId: string
    children: ReactNode
}) => (
    <div className="flex h-dvh">
        <NavRail workspaceId={workspaceId} projectId={projectId} />
        <main className="min-w-0 flex-1">{children}</main>
    </div>
)
