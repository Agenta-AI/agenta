import type {ReactNode} from "react"

import type {SidebarScope} from "@agenta/navigation"

import {useTrackLastNonSettingsPath} from "./lastNonSettingsPath"
import {NavRail} from "./NavRail"

/**
 * The viewport-aware app frame: a persistent sidebar at lg+ beside the screen, nothing below
 * lg (where screens carry the NavDrawer hamburger in their own headers). Screens wrap their
 * ScreenScaffold in this — the scaffold's `h-dvh` column becomes the flex-1 main pane.
 *
 * `scope` replaces the main nav for screens that take the rail over (settings).
 */
export const AppShell = ({
    workspaceId,
    projectId,
    scope,
    children,
}: {
    workspaceId: string
    projectId: string
    scope?: SidebarScope
    children: ReactNode
}) => {
    useTrackLastNonSettingsPath()

    return (
        <div className="flex h-[var(--ag-viewport-height,100dvh)]">
            <NavRail workspaceId={workspaceId} projectId={projectId} scope={scope} />
            <main className="min-w-0 flex-1">{children}</main>
        </div>
    )
}
