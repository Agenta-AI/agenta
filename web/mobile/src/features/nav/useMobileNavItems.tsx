import {createElement, useMemo} from "react"

import {
    defineSidebarEntity,
    resolveChildren,
    SESSIONS_SIDEBAR_KEY,
    sidebarSessionsListAtom,
    type SessionSidebarRef,
    type SidebarConfig,
} from "@agenta/navigation"
import {useAtomValue} from "jotai"
import {Circle, House, MessagesSquare, Pin} from "lucide-react"

/** The drawer's scope id — its open-groups persistence bucket. */
export const MOBILE_NAV_SCOPE_ID = "mobile-main"

/**
 * Mobile's registration over the SHARED machinery: same gated sessions source, same
 * grouping (Pinned first), mobile's own child routes. Desktop's registry entry differs only
 * in its paths and its pending-open handoff — the model is the reuse, the content is ours.
 */
const mobileSessionsEntity = defineSidebarEntity<SessionSidebarRef>(
    MOBILE_NAV_SCOPE_ID,
    SESSIONS_SIDEBAR_KEY,
    {
        kind: "app",
        icon: createElement(MessagesSquare, {size: 14}),
        listAtom: sidebarSessionsListAtom,
        getLabel: (session) => session.name || "Untitled session",
        childPath: (session) => `/sessions/${session.sessionId}`,
        emptyLabel: "No sessions yet",
        showAllPath: "/sessions",
        getGroup: (session) => (session.pinned ? "Pinned" : null),
        getIcon: (session) =>
            session.pinned
                ? createElement(Pin, {size: 12})
                : createElement(Circle, {
                      size: 8,
                      fill: session.alive ? "currentColor" : "none",
                  }),
    },
)

/** The drawer's nav model. Entries appear here as their screens land — one list, model-driven. */
export const useMobileNavItems = (projectURL: string): SidebarConfig[] => {
    const source = useAtomValue(mobileSessionsEntity.activeSourceAtom)

    return useMemo(
        () => [
            {
                key: "mobile-home",
                title: "Home",
                icon: createElement(House, {size: 16}),
                link: `${projectURL}/apps`,
            },
            {
                key: SESSIONS_SIDEBAR_KEY,
                title: "Sessions",
                icon: createElement(MessagesSquare, {size: 16}),
                link: `${projectURL}/sessions`,
                defaultOpen: true,
                submenu: resolveChildren(mobileSessionsEntity, source, projectURL),
            },
        ],
        [source, projectURL],
    )
}
