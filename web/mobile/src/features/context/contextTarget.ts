import type {LastContext} from "@/lib/context"

import type {WorkspaceGroup} from "./workspaceGroups"

export interface ContextTargetInput {
    /** False until the router has parsed the query string. */
    ready: boolean
    /** Pair remembered from a previous visit. */
    shortcut: LastContext | null
    groups: WorkspaceGroup[]
    /** Desktop's last-used project per workspace. */
    desktopLastUsed: Record<string, string>
}

/**
 * Which project `/m/` forwards to. Mirrors the desktop: remembered pair, then desktop
 * continuity, then the first project — switching happens in the drawer, never on a page,
 * so there is no picker to fall back to. `null` only while unresolvable (not ready, or the
 * account has no projects).
 */
export const selectContextTarget = ({
    ready,
    shortcut,
    groups,
    desktopLastUsed,
}: ContextTargetInput): LastContext | null => {
    if (!ready) return null
    if (shortcut) return shortcut
    if (groups.length === 0) return null
    // Desktop continuity: the desktop's last-used pair, when it still exists in the fetched tree.
    for (const group of groups) {
        const projectId = desktopLastUsed[group.workspaceId]
        if (projectId && group.projects.some((p) => p.project_id === projectId)) {
            return {workspaceId: group.workspaceId, projectId}
        }
    }
    const first = groups[0]
    return {workspaceId: first.workspaceId, projectId: first.projects[0]?.project_id ?? ""}
}
