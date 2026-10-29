import {createElement, useCallback, useMemo, type ReactNode} from "react"

import {
    SESSIONS_SIDEBAR_KEY,
    type SessionSidebarRef,
    type SidebarEntityRef,
    type SidebarRowWrappers,
} from "@agenta/navigation"
import {SessionRowActions, useSessionRowChrome} from "@agenta/sessions-ui"

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

    const wrapSessionRow = useCallback(
        (ref: SidebarEntityRef, node: ReactNode) =>
            createElement(SessionRowActions, {
                session: ref as SessionSidebarRef,
                chrome,
                children: node,
            }),
        [chrome],
    )

    return useMemo(() => ({[SESSIONS_SIDEBAR_KEY]: wrapSessionRow}), [wrapSessionRow])
}
