import {createElement, type ReactElement, type ReactNode} from "react"

import type {SidebarConfig} from "@agenta/navigation"
import type {SessionRowStatus} from "@agenta/sessions/row"
import type {SessionRowTarget} from "@agenta/sessions-ui"
import {
    ArrowClockwiseIcon,
    BroadcastIcon,
    ChatsIcon,
    PlusIcon,
    SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import {ChartColumn} from "lucide-react"

import {
    RUNNING_TITLE,
    sessionMarkOf,
    sessionStatusMark,
    withStatusMark,
} from "../nav/sessionStatusMark"

import {agentPageHref, isAgentPageView, type AgentPageView} from "./agentPages"
import {dayGroupedRows} from "./dayGroups"

/** One session row of the agent sidebar: what the row draws and what its menu needs. */
export interface AgentSidebarSession extends SessionRowTarget {
    title: string
    /** ISO time of the last activity, for the day groups. */
    activityAt: string | null
    status: SessionRowStatus
    isAutomation: boolean
}

export type AgentSidebarText = (
    key:
        | "agentSidebar.newSession"
        | "agentSidebar.configuration"
        | "agentSidebar.channels"
        | "agentSidebar.analytics"
        | "agentSidebar.sessions"
        | "agentSidebar.seeAllSessions"
        | "agentSidebar.today"
        | "agentSidebar.yesterday"
        | "agentSidebar.earlier"
        | "agentSidebar.showOlderSessions"
        | "agentSidebar.showOlderSessionsShort"
        | "agentSidebar.loading"
        | "agentSidebar.loadError"
        | "agentSidebar.retry"
        | "agentSidebar.noSessionsMatch",
    values?: {count: number},
) => string

export const AGENT_SIDEBAR_SESSIONS_KEY = "agent-sidebar-sessions"

export const AGENT_SIDEBAR_NEW_SESSION_KEY = "agent-sidebar-new-session"

export const agentSidebarSessionKey = (sessionId: string) => `agent-sidebar-session-${sessionId}`

/** The row that marks an agent page as the current one. */
const pageRowKey = (view: AgentPageView) =>
    view === "sessions" ? AGENT_SIDEBAR_SESSIONS_KEY : `agent-sidebar-${view}`

/**
 * The current row: the agent page on screen, else the open session. A session this agent's
 * "New session" opened (`?agent=`) that the list does not show yet is "New session".
 */
export const agentSidebarSelectedKey = (
    query: Record<string, string | string[] | undefined>,
    agentId: string,
    listed: ReadonlySet<string>,
): string | undefined => {
    if (query.agent_id === agentId && typeof query.view === "string")
        return isAgentPageView(query.view) ? pageRowKey(query.view) : undefined
    if (typeof query.session_id !== "string") return undefined
    if (query.agent === agentId && !listed.has(query.session_id))
        return AGENT_SIDEBAR_NEW_SESSION_KEY
    return agentSidebarSessionKey(query.session_id)
}

export type SessionBulletState = "idle" | "live" | "waiting"

const BULLET_STATE: Record<SessionBulletState, string> = {
    idle: "border-colorTextTertiary",
    live: "border-colorText bg-colorText",
    // `--ag-run-status-warning`: the palette's bright amber in both themes.
    waiting: "border-[var(--ag-run-status-warning)] bg-[var(--ag-run-status-warning)]",
}

/**
 * The ring in front of a session or chat row: 8 px with a 1.25 px rim, 2 px clear of its
 * neighbours, so the title starts where the design puts it. Filled while the session is live,
 * amber while it waits for the person. The main, agent and builder sidebars all draw it.
 */
export const sessionBullet = (state: SessionBulletState) =>
    createElement("span", {
        "aria-hidden": true,
        className: `mx-0.5 box-border block size-2 shrink-0 rounded-full border-[1.25px] border-solid ${BULLET_STATE[state]}`,
    })

/**
 * The rows of one agent's sidebar: `pages` is New session, Configuration, Channels and Analytics;
 * `sessions` is the "Sessions" row with its filter, the latest sessions grouped by day, and
 * "Show N older sessions" when the agent has more. `total` is null until the count loads.
 */
export const agentSidebarItems = ({
    projectURL,
    agentId,
    newSessionHref,
    onNewSession,
    sessions,
    total,
    status = "ready",
    onRetry,
    t,
    phone = false,
    wrapSessionRow,
    sessionsActions,
    filtered = false,
}: {
    projectURL: string
    agentId: string
    /** Where "New session" links; a plain click runs `onNewSession` in its place. */
    newSessionHref: string
    onNewSession: () => void
    sessions: AgentSidebarSession[]
    total: number | null
    /** The session list's state. A failed refresh keeps the sessions it had. */
    status?: "loading" | "error" | "ready"
    /** Reads the session list again after a failed first load. */
    onRetry?: () => void
    t: AgentSidebarText
    /** The phone sheet: "Show older sessions" without the count, as the phone design writes it. */
    phone?: boolean
    /** The row menu and inline rename, as the main sidebar has them. */
    wrapSessionRow?: (
        session: SessionRowTarget,
        node: ReactNode,
        status?: ReactNode,
    ) => ReactElement
    /** The control at the right of the "Sessions" row: the filter. */
    sessionsActions?: ReactNode
    /** The filter menu narrows the list: an empty list says so, and the "older" row, which
     * opens the unfiltered Sessions page, is left out. */
    filtered?: boolean
}): {pages: SidebarConfig[]; sessions: SidebarConfig} => {
    const sessionsHref = agentPageHref(projectURL, agentId, "sessions")
    const pageRow = (view: AgentPageView, title: string, icon: ReactNode): SidebarConfig => ({
        key: pageRowKey(view),
        title,
        icon,
        link: agentPageHref(projectURL, agentId, view),
        matchLinks: [],
        prefetch: false,
    })

    const rows = dayGroupedRows(sessions, {
        activityAt: (session) => session.activityAt,
        keyPrefix: "agent-sidebar-day",
        label: (key) => t(`agentSidebar.${key}`),
        toRow: (session) => ({
            key: agentSidebarSessionKey(session.sessionId),
            title: session.title,
            tooltip: session.title,
            rowClassName: session.status === "running" ? RUNNING_TITLE : undefined,
            link: `${projectURL}/sessions/${session.sessionId}`,
            prefetch: false,
            // The state shows as a quiet mark on the right, as on the main sidebar.
            wrapRow: (node) => {
                const status = sessionStatusMark(
                    sessionMarkOf({
                        running: session.status === "running",
                        waiting: session.status === "waiting",
                        alive: session.status === "alive",
                    }),
                )
                return wrapSessionRow
                    ? wrapSessionRow(session, node, status)
                    : withStatusMark(node, status)
            },
        }),
    })
    if (sessions.length === 0 && status === "loading")
        rows.push({
            key: "agent-sidebar-sessions-loading",
            title: t("agentSidebar.loading"),
            disabled: true,
            isLoading: true,
        })
    if (sessions.length === 0 && status === "error")
        rows.push(
            {
                key: "agent-sidebar-sessions-error",
                title: t("agentSidebar.loadError"),
                disabled: true,
                isPlaceholder: true,
            },
            {
                key: "agent-sidebar-sessions-retry",
                title: t("agentSidebar.retry"),
                icon: createElement(ArrowClockwiseIcon, {size: 16}),
                onClick: () => onRetry?.(),
            },
        )
    if (sessions.length === 0 && status === "ready" && filtered)
        rows.push({
            key: "agent-sidebar-sessions-none-match",
            title: t("agentSidebar.noSessionsMatch"),
            disabled: true,
            isPlaceholder: true,
        })
    const older = total !== null && !filtered ? total - sessions.length : 0
    if (older > 0)
        rows.push({
            key: "agent-sidebar-older",
            title: phone
                ? t("agentSidebar.showOlderSessionsShort")
                : t("agentSidebar.showOlderSessions", {count: older}),
            link: sessionsHref,
            matchLinks: [],
            prefetch: false,
            // The phone row keeps its 44 px line box, so the text sits in the middle (M02).
            rowClassName: `text-[13px] ${phone ? "leading-[44px] text-colorTextTertiary" : "text-colorTextSecondary"}`,
        })

    return {
        pages: [
            {
                key: AGENT_SIDEBAR_NEW_SESSION_KEY,
                title: t("agentSidebar.newSession"),
                icon: createElement(PlusIcon, {size: 16}),
                link: newSessionHref,
                matchLinks: [],
                prefetch: false,
                // The shell skips modified clicks, so those still open the link in a new tab.
                onClick: (event) => {
                    event.preventDefault()
                    onNewSession()
                },
            },
            pageRow(
                "configuration",
                t("agentSidebar.configuration"),
                createElement(SlidersHorizontalIcon, {size: 16}),
            ),
            pageRow(
                "channels",
                t("agentSidebar.channels"),
                createElement(BroadcastIcon, {size: 16}),
            ),
            // The canvas draws Analytics as a bar chart with axes (Lucide); Phosphor has none.
            pageRow(
                "analytics",
                t("agentSidebar.analytics"),
                createElement(ChartColumn, {size: 16}),
            ),
        ],
        sessions: {
            key: AGENT_SIDEBAR_SESSIONS_KEY,
            title: t("agentSidebar.sessions"),
            tooltip: t("agentSidebar.seeAllSessions"),
            icon: createElement(ChatsIcon, {size: 16}),
            link: sessionsHref,
            matchLinks: [],
            prefetch: false,
            hideChildrenWhenCollapsed: true,
            // No caret: the filter is this group's control.
            alwaysOpen: true,
            scrollChildren: true,
            groupAction: sessionsActions,
            submenu: rows,
        },
    }
}
