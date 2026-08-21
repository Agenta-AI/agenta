import type {LastContext} from "@/lib/context"

import type {WorkspaceGroup} from "./workspaceGroups"

export interface ContextTargetInput {
    /** False until the router has parsed the query string. */
    ready: boolean
    /** Pair remembered from a previous visit. */
    shortcut: LastContext | null
    groups: WorkspaceGroup[]
    /**
     * True once the projects fetch has answered. Explicit, not `groups.length > 0`: an empty
     * `groups` means "not fetched yet" far more often than it means "no projects", and the
     * shortcut's fast path must survive the former.
     */
    groupsLoaded: boolean
    /** Desktop's last-used project per workspace. */
    desktopLastUsed: Record<string, string>
    /**
     * Set by the `/w/:workspace_id[/p]` gates: confine resolution to the workspace the URL
     * names, so a link into a workspace lands in THAT workspace rather than the remembered
     * one. Unset (`/m/`, `/m/w`) resolves across the whole tree.
     */
    workspaceId?: string | null
}

const contains = (groups: WorkspaceGroup[], {workspaceId, projectId}: LastContext) =>
    groups.some(
        (group) =>
            group.workspaceId === workspaceId &&
            group.projects.some((project) => project.project_id === projectId),
    )

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
    groupsLoaded,
    desktopLastUsed,
    workspaceId,
}: ContextTargetInput): LastContext | null => {
    if (!ready) return null

    const inScope = workspaceId ? groups.filter((g) => g.workspaceId === workspaceId) : groups
    // A URL naming a workspace the loaded tree does not hold — typo, deleted, access revoked —
    // is not a dead end: resolve it across the whole tree, exactly as `/m/` would.
    const pool = workspaceId && groupsLoaded && inScope.length === 0 ? groups : inScope

    // Scoped routes may only use the remembered pair when it belongs to the named workspace.
    const usable = shortcut && (!workspaceId || shortcut.workspaceId === workspaceId)
    // The remembered pair forwards on sight; only a fetched tree that no longer holds it —
    // project deleted, access revoked — is grounds to drop it and resolve again.
    if (usable && shortcut && (!groupsLoaded || contains(pool, shortcut))) return shortcut
    if (pool.length === 0) return null
    // Desktop continuity: the desktop's last-used pair, when it still exists in the fetched tree.
    for (const group of pool) {
        const projectId = desktopLastUsed[group.workspaceId]
        if (projectId && group.projects.some((p) => p.project_id === projectId)) {
            return {workspaceId: group.workspaceId, projectId}
        }
    }
    const first = pool[0]
    return {workspaceId: first.workspaceId, projectId: first.projects[0]?.project_id ?? ""}
}
