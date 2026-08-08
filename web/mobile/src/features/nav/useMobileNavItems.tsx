import {createElement, useMemo} from "react"

import {
    buildHelpDocsNavItem,
    defineSidebarEntity,
    resolveChildren,
    SESSIONS_SIDEBAR_KEY,
    sidebarSessionsListAtom,
    type SessionSidebarRef,
    type SidebarConfig,
} from "@agenta/navigation"
import {useAtomValue} from "jotai"
import {
    Bot,
    CalendarClock,
    Circle,
    HelpCircle,
    Github,
    House,
    MessagesSquare,
    Pin,
    ScrollText,
    Settings,
    Slack,
} from "lucide-react"

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
        // Both halves are named or neither is: a lone "Pinned" heading over an unlabelled
        // remainder reads as a stray row. The resolver drops both when nothing is pinned.
        getGroup: (session) => (session.pinned ? "Pinned" : "Recent"),
        getIcon: (session) =>
            session.pinned
                ? createElement(Pin, {size: 12})
                : createElement(Circle, {
                      size: 8,
                      fill: session.alive ? "currentColor" : "none",
                  }),
    },
)

/**
 * The rail's nav model — the same keys, order and icon sizes the desktop rail uses, narrowed
 * to the screens mobile has. Entries appear here as their screens land; nothing is hidden by
 * forking a component.
 */
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
            {
                key: "mobile-agents",
                title: "Agents",
                icon: createElement(Bot, {size: 16}),
                link: `${projectURL}/agents`,
            },
        ],
        [source, projectURL],
    )
}

/**
 * The pinned bottom entries — the desktop rail's, minus what has no mobile destination.
 * Settings is a placeholder screen until its surfaces land; Help & Docs is the SHARED entry,
 * so both apps point at the same four places. "Invite Teammate" is omitted deliberately: it
 * deep-links into the settings workspace tab, which this app does not have yet.
 */
export const useMobileBottomNavItems = (projectURL: string): SidebarConfig[] =>
    useMemo(
        () => [
            {
                key: "mobile-settings",
                title: "Settings",
                icon: createElement(Settings, {size: 16}),
                link: `${projectURL}/settings`,
            },
            buildHelpDocsNavItem({
                icons: {
                    help: createElement(HelpCircle, {size: 16}),
                    docs: createElement(ScrollText, {size: 14}),
                    github: createElement(Github, {size: 14}),
                    slack: createElement(Slack, {size: 14}),
                    bookCall: createElement(CalendarClock, {size: 14}),
                },
            }),
        ],
        [projectURL],
    )
