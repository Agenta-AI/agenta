import type {LastContext} from "@/lib/context"

import type {WorkspaceGroup} from "./WorkspaceProjectList"

export interface ContextTargetInput {
    /** False until the router has parsed the query string. */
    ready: boolean
    /** `?switch=1` — the user asked for the picker, so every shortcut is off. */
    switching: boolean
    /** Pair remembered from a previous visit. */
    shortcut: LastContext | null
    groups: WorkspaceGroup[]
    /** Desktop's last-used project per workspace. */
    desktopLastUsed: Record<string, string>
}

/**
 * Which project `/m/` should forward to, or `null` to show the picker.
 *
 * Ordering is the whole point: `ready` gates everything because a forward decided before the
 * query string is parsed would blow straight past `?switch=1`, making the picker unreachable
 * once any context is stored.
 */
export const selectContextTarget = ({
    ready,
    switching,
    shortcut,
    groups,
    desktopLastUsed,
}: ContextTargetInput): LastContext | null => {
    if (!ready || switching) return null
    if (shortcut) return shortcut
    if (groups.length === 0) return null
    // Nothing to choose between.
    if (groups.length === 1 && groups[0].projects.length === 1) {
        return {workspaceId: groups[0].workspaceId, projectId: groups[0].projects[0].project_id}
    }
    // Desktop continuity: the desktop's last-used pair, when it still exists in the fetched tree.
    for (const group of groups) {
        const projectId = desktopLastUsed[group.workspaceId]
        if (projectId && group.projects.some((p) => p.project_id === projectId)) {
            return {workspaceId: group.workspaceId, projectId}
        }
    }
    return null
}
