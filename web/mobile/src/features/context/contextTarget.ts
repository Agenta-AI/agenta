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
    /**
     * Set by the `/w/:workspace_id[/p]` gates: confine resolution to the workspace the URL
     * names, so a link into a workspace lands in THAT workspace rather than the remembered
     * one. Unset (`/m/`, `/m/w`) resolves across the whole tree.
     */
    workspaceId?: string | null
}

/**
 * Whether a group is the one an id names: its route segment (the organization id), or a
 * workspace id an API pod answered for one of its projects (a saved pair or a link from before
 * workspace removal step 2).
 */
const names = (group: WorkspaceGroup, id: string) =>
    group.workspaceId === id || group.projects.some((project) => project.legacy_workspace_id === id)

/** The saved pair in the loaded tree, with the group's route segment; null when gone. */
const locate = (groups: WorkspaceGroup[], {workspaceId, projectId}: LastContext) => {
    const holds = (g: WorkspaceGroup) => g.projects.some((p) => p.project_id === projectId)
    // A pair saved before workspace removal step 2 can name a workspace id no group answers
    // any more; the project id alone still finds the project.
    const group =
        groups.find((g) => names(g, workspaceId) && holds(g)) ?? groups.find((g) => holds(g))
    return group ? {workspaceId: group.workspaceId, projectId} : null
}

/**
 * Which project `/m/` forwards to: the remembered pair, then the first project. Switching
 * happens in the drawer, never on a page, so there is no picker to fall back to. `null` only
 * while unresolvable (not ready, or the account has no projects).
 */
export const selectContextTarget = ({
    ready,
    shortcut,
    groups,
    groupsLoaded,
    workspaceId,
}: ContextTargetInput): LastContext | null => {
    if (!ready) return null

    const inScope = workspaceId ? groups.filter((g) => names(g, workspaceId)) : groups
    // A URL naming a workspace the loaded tree does not hold — typo, deleted, access revoked —
    // is not a dead end: resolve it across the whole tree, exactly as `/m/` would.
    const pool = workspaceId && groupsLoaded && inScope.length === 0 ? groups : inScope

    // Scoped routes may only use the remembered pair when it belongs to the named workspace.
    const usable =
        shortcut &&
        (!workspaceId ||
            shortcut.workspaceId === workspaceId ||
            inScope.some((g) => names(g, shortcut.workspaceId)))
    // The remembered pair forwards on sight; only a fetched tree that no longer holds it —
    // project deleted, access revoked — is grounds to drop it and resolve again. A loaded tree
    // answers the pair under the group's route segment (the organization id).
    if (usable && shortcut && !groupsLoaded) return shortcut
    const located = usable && shortcut ? locate(pool, shortcut) : null
    if (located) return located
    if (pool.length === 0) return null
    const first = pool[0]
    return {workspaceId: first.workspaceId, projectId: first.projects[0]?.project_id ?? ""}
}
