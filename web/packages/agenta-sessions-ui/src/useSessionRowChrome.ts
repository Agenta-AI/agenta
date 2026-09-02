import {useCallback, useMemo} from "react"

import type {SessionActionTarget, useSessionActions} from "./useSessionActions"

export interface SessionRowChrome {
    menuItems: ReturnType<typeof useSessionActions>["menuItems"]
    onMenuClick: ReturnType<typeof useSessionActions>["onMenuClick"]
    /** Commits a rename and refreshes every list that shows the name. `false` on failure. */
    renameSession: (target: SessionActionTarget, name: string) => Promise<boolean>
}

/**
 * The row-INDEPENDENT half of a session row's chrome, resolved once for the whole rail.
 *
 * Every row used to call `useSessionActions` itself, so a 41-row rail held 41 copies of the same
 * verbs — each with its own query client, project id and eight callbacks — none of which differ
 * by row. Only the open/renaming/draft state is genuinely per-row, and that stays there.
 *
 * The ACTIONS come from the host, not from here: the desktop binding wraps them with its local
 * tab cache, and a rail must act on a session the same way the surface it sits beside does.
 */
export const useSessionRowChrome = ({
    menuItems,
    onMenuClick,
    commitRename,
}: Pick<
    ReturnType<typeof useSessionActions>,
    "menuItems" | "onMenuClick" | "commitRename"
>): SessionRowChrome => {
    // Straight through to the shared verb: it owns the cache-or-server branch AND the
    // revalidation, so the rail's inline rename cannot drift from the menu's modal one.
    const renameSession = useCallback(
        (target: SessionActionTarget, name: string) => commitRename(target, name),
        [commitRename],
    )

    // One stable object, so a row's props only change when a verb actually does.
    return useMemo(
        () => ({menuItems, onMenuClick, renameSession}),
        [menuItems, onMenuClick, renameSession],
    )
}
