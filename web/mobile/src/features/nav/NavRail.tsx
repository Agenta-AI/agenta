import {NavPanel} from "./NavPanel"

/**
 * The persistent lg+ sidebar — the drawer's content, docked. Hidden below lg, where the same
 * `NavPanel` lives inside the NavDrawer sheet instead; the two share one nav model and one
 * open-groups bucket, so expanding Sessions in the drawer keeps it expanded on the rail.
 */
export const NavRail = ({workspaceId, projectId}: {workspaceId: string; projectId: string}) => (
    <aside className="border-border bg-background hidden h-dvh w-[260px] shrink-0 flex-col border-r pt-[env(safe-area-inset-top)] lg:flex">
        <NavPanel workspaceId={workspaceId} projectId={projectId} />
    </aside>
)
