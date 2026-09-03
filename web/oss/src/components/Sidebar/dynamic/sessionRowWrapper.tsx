import {createElement, useCallback, useMemo, type ReactNode} from "react"

import {
    moveSidebarManualOrderAtom,
    SESSIONS_SIDEBAR_KEY,
    type SessionSidebarRef,
    type SidebarEntityRef,
    type RowReorder,
    type SidebarRowWrappers,
} from "@agenta/navigation"
import {SessionRowActions, useSessionRowChrome} from "@agenta/sessions-ui"
import {useSetAtom} from "jotai"

import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"

/**
 * The rail's per-row session verbs, bound to the OSS actions.
 *
 * The component is shared with the mobile rail; only the actions differ, and they have to: this
 * binding wraps them with the playground's local tab cache, so renaming from the rail updates an
 * open chat tab instead of leaving it stale.
 */
export const useSessionRowWrappers = (): SidebarRowWrappers => {
    // Resolved ONCE for the rail, not once per row: the verbs do not differ by session.
    const chrome = useSessionRowChrome(useSessionActions())
    const moveOrder = useSetAtom(moveSidebarManualOrderAtom)

    const wrapSessionRow = useCallback(
        (ref: SidebarEntityRef, node: ReactNode, reorder?: RowReorder) =>
            createElement(SessionRowActions, {
                session: ref as SessionSidebarRef,
                chrome,
                // The touch path: a long press opens this menu, so it cannot also start a drag.
                reorder: reorder && {
                    canUp: reorder.index > 0,
                    canDown: reorder.index < reorder.ids.length - 1,
                    onMove: (delta: -1 | 1) =>
                        moveOrder({zone: reorder.zone, ids: reorder.ids, id: ref.id, delta}),
                },
                children: node,
            }),
        [chrome, moveOrder],
    )

    return useMemo(() => ({[SESSIONS_SIDEBAR_KEY]: wrapSessionRow}), [wrapSessionRow])
}
