import {createElement, type ReactElement, type ReactNode} from "react"

import {formatNumber} from "@agenta/i18n"
import type {SidebarConfig} from "@agenta/navigation"
import type {SessionRowStatus} from "@agenta/sessions/row"
import type {SessionRowTarget} from "@agenta/sessions-ui"
import {Spinner} from "@agenta/ui/ui"
import {
    ArrowClockwiseIcon,
    BroadcastIcon,
    ChartBarIcon,
    FadersHorizontalIcon,
    LightningIcon,
    SlidersHorizontalIcon,
} from "@phosphor-icons/react"
import Link from "next/link"

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
        | "agentSidebar.filter"
        | "agentSidebar.loading"
        | "agentSidebar.loadError"
        | "agentSidebar.retry",
    values?: {count: number},
) => string

export const AGENT_SIDEBAR_SESSIONS_KEY = "agent-sidebar-sessions"

/** The Sessions page query that opens its filter menu on arrival (the page reads it). */
export const SESSIONS_FILTERS_OPEN = "filters=open"
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

/** The run state as the main sidebar draws it: a spinner while running, amber while waiting. */
const sessionIcon = (session: AgentSidebarSession) => {
    if (session.status === "running") return createElement(Spinner, {className: "size-3"})
    const live = session.status === "waiting" || session.status === "alive"
    if (session.isAutomation)
        return createElement(LightningIcon, {
            size: 12,
            weight: live ? "fill" : "regular",
            className:
                session.status === "waiting" ? "text-[var(--ag-run-status-warning)]" : undefined,
        })
    return sessionBullet(session.status === "waiting" ? "waiting" : live ? "live" : "idle")
}

/**
 * The rows of one agent's sidebar (A01): Configuration, Channels, Analytics, then the heading
 * link "Sessions" with the count and a Filter button, the latest sessions grouped by day, and
 * "Show N older sessions" when the agent has more. `total` is null until the count loads.
 * "New session" is a button in the sidebar's header, not a row.
 */
export const agentSidebarItems = ({
    projectURL,
    agentId,
    sessions,
    total,
    status = "ready",
    onRetry,
    t,
    phone = false,
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
    /** The phone sheet: "Show older sessions" without the count, as the phone design writes it. */
    phone?: boolean
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
            title: phone
                ? t("agentSidebar.showOlderSessionsShort")
                : t("agentSidebar.showOlderSessions", {count: older}),
            link: sessionsHref,
            matchLinks: [],
            prefetch: false,
            rowClassName: `text-[13px] ${phone ? "text-colorTextTertiary" : "text-colorTextSecondary"}`,
        })

    return [
        pageRow(
            "configuration",
            t("agentSidebar.configuration"),
            createElement(SlidersHorizontalIcon, {size: 16}),
        ),
        pageRow("channels", t("agentSidebar.channels"), createElement(BroadcastIcon, {size: 16})),
        pageRow("analytics", t("agentSidebar.analytics"), createElement(ChartBarIcon, {size: 16})),
        {
            key: AGENT_SIDEBAR_SESSIONS_KEY,
            title: t("agentSidebar.sessions"),
            tooltip: t("agentSidebar.seeAllSessions"),
            link: sessionsHref,
            matchLinks: [],
            prefetch: false,
            hideChildrenWhenCollapsed: true,
            // Always open with no icon: the rail draws it as a small heading link, not a row.
            alwaysOpen: true,
            scrollChildren: true,
            // No number until the count loads; the phone sheet draws none.
            suffix: total !== null && !phone ? formatNumber(total) : undefined,
            // The filters live on the Sessions page of this agent: Filter opens it with the
            // filter menu open.
            groupAction: createElement(
                Link,
                {
                    href: `${sessionsHref}&${SESSIONS_FILTERS_OPEN}`,
                    prefetch: false,
                    "aria-label": t("agentSidebar.filter"),
                    title: t("agentSidebar.filter"),
                    className:
                        "flex size-6 items-center justify-center rounded-sm !text-colorTextSecondary no-underline hover:bg-colorFillTertiary hover:!text-colorText",
                },
                createElement(FadersHorizontalIcon, {size: 14}),
            ),
            submenu: rows,
        },
    ]
}
