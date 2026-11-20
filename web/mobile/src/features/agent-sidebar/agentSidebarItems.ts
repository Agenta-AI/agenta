import {createElement, type MouseEvent, type ReactElement, type ReactNode} from "react"

import {formatNumber} from "@agenta/i18n"
import type {SidebarConfig} from "@agenta/navigation"
import type {SessionRowStatus} from "@agenta/sessions/row"
import type {SessionRowTarget} from "@agenta/sessions-ui"
import {Spinner} from "@agenta/ui/ui"
import {
    ArrowClockwiseIcon,
    ChartLineIcon,
    CircleIcon,
    LightningIcon,
    PlusIcon,
    RadioIcon,
    SlidersHorizontalIcon,
} from "@phosphor-icons/react"

import {agentPageHref, isAgentPageView, type AgentPageView} from "./agentPages"
import {groupByDay} from "./dayGroups"

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
        | "agentSidebar.loading"
        | "agentSidebar.loadError"
        | "agentSidebar.retry",
    values?: {count: number},
) => string

export const AGENT_SIDEBAR_SESSIONS_KEY = "agent-sidebar-sessions"
export const agentSidebarSessionKey = (sessionId: string) => `agent-sidebar-session-${sessionId}`

/** The row that marks an agent page as the current one. */
const pageRowKey = (view: AgentPageView) =>
    view === "sessions" ? AGENT_SIDEBAR_SESSIONS_KEY : `agent-sidebar-${view}`

/** The current row: the agent page on screen, else the open session. */
export const agentSidebarSelectedKey = (
    query: Record<string, string | string[] | undefined>,
    agentId: string,
): string | undefined => {
    if (query.agent_id === agentId && typeof query.view === "string")
        return isAgentPageView(query.view) ? pageRowKey(query.view) : undefined
    return typeof query.session_id === "string"
        ? agentSidebarSessionKey(query.session_id)
        : undefined
}

/** The run state as the main sidebar draws it: a spinner while running, amber while waiting. */
const sessionIcon = (session: AgentSidebarSession) => {
    if (session.status === "running") return createElement(Spinner, {className: "size-3"})
    const live = session.status === "waiting" || session.status === "alive"
    const weight = live ? "fill" : "regular"
    const className =
        session.status === "waiting" ? "text-[var(--ag-run-status-warning)]" : undefined
    return session.isAutomation
        ? createElement(LightningIcon, {size: 12, weight, className})
        : createElement(CircleIcon, {size: 8, weight, className})
}

/**
 * The rows of one agent's sidebar (A01): New session, Configuration, Channels, Analytics, then
 * the link "Sessions" with the count, the latest sessions grouped by day, and "Show N older
 * sessions" when the agent has more. `total` is null until the count loads.
 */
export const agentSidebarItems = ({
    projectURL,
    agentId,
    sessions,
    total,
    status = "ready",
    onRetry,
    t,
    newSessionHref,
    onNewSession,
    wrapSessionRow,
}: {
    projectURL: string
    agentId: string
    sessions: AgentSidebarSession[]
    total: number | null
    /** The session list's state. A failed refresh keeps the sessions it had. */
    status?: "loading" | "error" | "ready"
    /** Reads the session list again after a failed first load. */
    onRetry?: () => void
    t: AgentSidebarText
    /** What "New session" opens in a new tab; a plain click runs `onNewSession`. */
    newSessionHref: string
    onNewSession: (event: MouseEvent) => void
    /** The row menu and inline rename, as the main sidebar has them. */
    wrapSessionRow?: (session: SessionRowTarget, node: ReactNode) => ReactElement
}): SidebarConfig[] => {
    const sessionsHref = agentPageHref(projectURL, agentId, "sessions")
    const pageRow = (view: AgentPageView, title: string, icon: ReactNode): SidebarConfig => ({
        key: pageRowKey(view),
        title,
        icon,
        link: agentPageHref(projectURL, agentId, view),
        matchLinks: [],
        prefetch: false,
    })

    const rows: SidebarConfig[] = groupByDay(sessions, (session) => session.activityAt).flatMap(
        (group) => [
            {
                key: `agent-sidebar-day-${group.key}`,
                title: t(`agentSidebar.${group.key}`),
                isGroupLabel: true,
            },
            ...group.rows.map(
                (session): SidebarConfig => ({
                    key: agentSidebarSessionKey(session.sessionId),
                    title: session.title,
                    tooltip: session.title,
                    icon: sessionIcon(session),
                    link: `${projectURL}/sessions/${session.sessionId}`,
                    prefetch: false,
                    wrapRow: wrapSessionRow ? (node) => wrapSessionRow(session, node) : undefined,
                }),
            ),
        ],
    )
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
    const older = total !== null ? total - sessions.length : 0
    if (older > 0)
        rows.push({
            key: "agent-sidebar-older",
            title: t("agentSidebar.showOlderSessions", {count: older}),
            link: sessionsHref,
            matchLinks: [],
            prefetch: false,
        })

    return [
        {
            key: "agent-sidebar-new",
            title: t("agentSidebar.newSession"),
            icon: createElement(PlusIcon, {size: 16}),
            link: newSessionHref,
            matchLinks: [],
            onClick: onNewSession,
        },
        pageRow(
            "configuration",
            t("agentSidebar.configuration"),
            createElement(SlidersHorizontalIcon, {size: 16}),
        ),
        pageRow("channels", t("agentSidebar.channels"), createElement(RadioIcon, {size: 16})),
        pageRow("analytics", t("agentSidebar.analytics"), createElement(ChartLineIcon, {size: 16})),
        {
            key: AGENT_SIDEBAR_SESSIONS_KEY,
            title: t("agentSidebar.sessions"),
            tooltip: t("agentSidebar.seeAllSessions"),
            link: sessionsHref,
            matchLinks: [],
            prefetch: false,
            hideChildrenWhenCollapsed: true,
            alwaysOpen: true,
            scrollChildren: true,
            // No number until the count loads.
            groupAction:
                total !== null
                    ? createElement(
                          "span",
                          {className: "text-xs text-colorTextTertiary"},
                          formatNumber(total),
                      )
                    : undefined,
            submenu: rows,
        },
    ]
}
