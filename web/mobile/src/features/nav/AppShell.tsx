import type {ReactNode} from "react"

import type {SidebarScope} from "@agenta/navigation"

import {useScreenEnter} from "@/lib/motion/useScreenEnter"

import {useTrackLastNonSettingsPath} from "./lastNonSettingsPath"
import {MobileCommandPalette} from "./MobileCommandPalette"
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
    const enter = useScreenEnter()

    return (
        <div className="flex h-[var(--ag-viewport-height,100dvh)]">
            <NavRail workspaceId={workspaceId} projectId={projectId} scope={scope} />
            {/* A new screen rises in as it mounts; the rail holds still. */}
            <main className={`min-w-0 flex-1${enter ? " animate-screen-in" : ""}`}>{children}</main>
            <MobileCommandPalette projectURL={`/w/${workspaceId}/p/${projectId}`} />
        </div>
    )
}
