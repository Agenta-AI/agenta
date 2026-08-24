import {useCallback, useMemo} from "react"

import {setSessionHeader} from "@agenta/entities/session"
import {useSessionActions} from "@agenta/sessions-ui"
import {projectIdAtom} from "@agenta/shared/state"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

export interface SessionRowChrome {
    menuItems: ReturnType<typeof useSessionActions>["menuItems"]
    onMenuClick: ReturnType<typeof useSessionActions>["onMenuClick"]
    /** Commits a rename and refreshes every list that shows the name. `false` on failure. */
    renameSession: (sessionId: string, name: string) => Promise<boolean>
}

/**
 * The row-INDEPENDENT half of a session row's chrome, resolved once for the whole rail.
 *
 * Every row used to call `useSessionActions` itself, so a 41-row rail held 41 copies of the same
 * verbs — each with its own query client, project id and eight callbacks — none of which differ
 * by row. Only the open/renaming/draft state is genuinely per-row, and that stays there.
 */
export const useSessionRowChrome = (): SessionRowChrome => {
    const {menuItems, onMenuClick} = useSessionActions()
    const queryClient = useQueryClient()
    const projectId = useAtomValue(projectIdAtom) ?? ""

    const renameSession = useCallback(
        async (sessionId: string, name: string) => {
            const ok = await setSessionHeader({sessionId, projectId, name})
            if (!ok) return false
            // The same key set the shared verbs invalidate, plus the rail's own two.
            for (const key of [
                ["sidebar-sessions"],
                ["sidebar-sessions-pinned"],
                ["session-list"],
                ["sessions-page"],
            ]) {
                void queryClient.invalidateQueries({queryKey: key})
            }
            return true
        },
        [projectId, queryClient],
    )

    // One stable object, so a row's props only change when a verb actually does.
    return useMemo(
        () => ({menuItems, onMenuClick, renameSession}),
        [menuItems, onMenuClick, renameSession],
    )
}
