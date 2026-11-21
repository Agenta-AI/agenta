import {createElement, useCallback, useContext, useMemo} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {
    livePollInterval,
    setSidebarSessionFilterDefaults,
    sidebarSessionFiltersAtomFamily,
    sidebarSessionFiltersDirtyAtomFamily,
} from "@agenta/navigation"
import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {
    SessionFilterMenu,
    SessionSearchButton,
    SidebarBackButton,
    SidebarLayoutContext,
    SidebarToggleButton,
} from "@agenta/navigation-ui"
import {sessionRowVm} from "@agenta/sessions/row"
import {pendingBySessionId, useActionableInteractions} from "@agenta/sessions/state"
import {keepPreviousData, useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {agentEntryHref} from "../agents/agentEntry"
import {startBlankSession} from "../chat/useStartBlankSession"
import {DrawerProjectSwitcher} from "../nav/DrawerProjectSwitcher"
import {
    useMobileBottomNavItems,
    usePaletteShortcut,
    useRailSessionRowWrapper,
} from "../nav/useMobileNavItems"
import {CreditsRemainingWidget} from "../wallet/CreditsRemainingWidget"

import {agentSessionsNarrowing, agentSessionsQuery} from "./agentSessionsQuery"
import {AgentSidebarHeader} from "./AgentSidebarHeader"
import {
    agentSidebarItems,
    agentSidebarSelectedKey,
    type AgentSidebarSession,
} from "./agentSidebarItems"
import {ConnectedAgentSwitcher} from "./ConnectedAgentSwitcher"
import {openMainSidebar, useSelectedSidebar} from "./selectedSidebar"
import {SidebarNewButton} from "./SidebarNewButton"

/** The filter menu's facets in the agent sidebar. */
const AGENT_SIDEBAR_FILTER_FACETS = ["type", "status", "activity"] as const

/** How many latest sessions the agent sidebar lists; "Show N older sessions" opens the rest. */
export const AGENT_SIDEBAR_SESSION_LIMIT = 10

/** The filter scope of one agent's sidebar: its own, so it never narrows the main sidebar. */
export const agentSidebarFilterScope = (agentId: string) => `agent-sidebar:${agentId}`

/**
 * The agent's latest sessions and the count of all its sessions, in one request, narrowed by
 * the sidebar's filter menu (Type, Status, Last activity).
 */
const useAgentSessions = (projectId: string, agentId: string) => {
    const filters = useAtomValue(sidebarSessionFiltersAtomFamily(agentSidebarFilterScope(agentId)))
    const interactions = useActionableInteractions(projectId)
    const pending = useMemo(() => pendingBySessionId(interactions.data), [interactions.data])
    // Joined, so a poll that returns the same waiting sessions keeps the same query. Read only
    // under "Waiting" and "Idle": no other filter depends on who is waiting.
    const usesWaiting = filters.status === "waiting" || filters.status === "idle"
    const waitingKey = !usesWaiting ? "" : pending ? [...pending.keys()].sort().join(",") : null
    // Per filter change, not per render: the activity floor reads the clock, and a new floor on
    // every render would make a new query each time.
    const narrowing = useMemo(
        () =>
            agentSessionsNarrowing(
                filters,
                waitingKey === null ? null : waitingKey.split(",").filter(Boolean),
            ),
        [filters, waitingKey],
    )
    const filtered = useAtomValue(
        sidebarSessionFiltersDirtyAtomFamily(agentSidebarFilterScope(agentId)),
    )
    // The waiting list failed to load (the lookup answers null): "Waiting" and "Idle" cannot be
    // answered.
    const waitingFailed = usesWaiting && interactions.data === null
    const query = useQuery({
        // Until the waiting list loads, a key of its own: never the unfiltered list's.
        ...agentSessionsQuery(
            projectId,
            agentId,
            AGENT_SIDEBAR_SESSION_LIMIT,
            narrowing ?? {sessionIds: []},
        ),
        // "Waiting" waits for the waiting list: without it the query would not be narrowed.
        enabled: Boolean(projectId) && narrowing !== null,
        // A filter change keeps the rows on screen until the narrowed page arrives.
        placeholderData: keepPreviousData,
        refetchOnWindowFocus: true,
        // The main sidebar's cadence: faster while a session runs or is alive.
        refetchInterval: (query) => livePollInterval(query.state.data?.sessions),
    })
    const sessions = useMemo(
        () =>
            (waitingFailed ? [] : (query.data?.sessions ?? [])).map((row): AgentSidebarSession => {
                const vm = sessionRowVm(row, {
                    pinned: false,
                    pending: pending?.get(row.session_id),
                })
                return {
                    sessionId: vm.id,
                    appId: vm.agentId,
                    name: row.name ?? null,
                    archived: Boolean(row.archived_at),
                    ownerUserId: row.owner_user_id ?? null,
                    title: vm.title,
                    activityAt: vm.activityAt,
                    status: vm.status.status,
                    isAutomation: vm.isAutomation,
                }
            }),
        [pending, query.data?.sessions, waitingFailed],
    )
    const status = waitingFailed
        ? "error"
        : query.isPending
          ? "loading"
          : query.isError
            ? "error"
            : "ready"
    const {refetch} = query
    const {refetch: refetchInteractions} = interactions
    const retry = useCallback(
        () => void (waitingFailed ? refetchInteractions() : refetch()),
        [refetch, refetchInteractions, waitingFailed],
    )
    return {sessions, total: query.data?.total ?? null, status, retry, filtered} as const
}

/**
 * One agent's own sidebar (A01). `railScope` loads this module only while an agent sidebar
 * shows.
 */
export const createAgentSidebarScope = (
    workspaceId: string,
    projectId: string,
    agentId: string,
): SidebarScope => {
    const projectURL = `/w/${workspaceId}/p/${projectId}`
    // Unfiltered by default: the list shows the agent's latest sessions of every kind and age,
    // as before the menu existed. Reset returns here.
    setSidebarSessionFilterDefaults(agentSidebarFilterScope(agentId), {
        type: "all",
        activity: "all",
        status: "all",
    })

    const useSelection = (): SidebarSelection => {
        const router = useRouter()
        const selectedKeyOverride = agentSidebarSelectedKey(router.query, agentId)
        return useMemo(
            () => (selectedKeyOverride ? {mode: "route", selectedKeyOverride} : {mode: "route"}),
            [selectedKeyOverride],
        )
    }

    // The phone sheet ends after the session list: no Templates, Settings, workspace switcher,
    // credits or row menus there (M02).
    const useSections = (): SidebarSection[] => {
        const t = useT(agentSidebarCatalog)
        const phone = useContext(SidebarLayoutContext) === "phone"
        const bottomItems = useMobileBottomNavItems(projectURL)
        const wrapSessionRow = useRailSessionRowWrapper(projectURL)
        const {sessions, total, status, retry, filtered} = useAgentSessions(projectId, agentId)
        const tNav = useT(navigationCatalog)
        const paletteShortcut = usePaletteShortcut()
        // The main sidebar's Sessions controls: search opens the search window, the filter
        // narrows this list. No Group by and no Agent: the agent is this one, and the list keeps
        // its day groups.
        const sessionsActions = useMemo(
            () =>
                createElement(
                    "span",
                    {className: "flex items-center gap-0.5"},
                    createElement(SessionSearchButton, {
                        label: tNav("navigation.items.search"),
                        shortcut: paletteShortcut,
                    }),
                    createElement(SessionFilterMenu, {
                        scopeId: agentSidebarFilterScope(agentId),
                        facets: AGENT_SIDEBAR_FILTER_FACETS,
                    }),
                ),
            [paletteShortcut, tNav],
        )

        return useMemo(() => {
            const agent: SidebarSection = {
                key: "agent",
                items: agentSidebarItems({
                    projectURL,
                    agentId,
                    sessions,
                    total,
                    status,
                    onRetry: retry,
                    t,
                    phone,
                    wrapSessionRow: phone ? undefined : wrapSessionRow,
                    sessionsActions,
                    filtered,
                }),
            }
            return phone
                ? [agent]
                : [
                      agent,
                      {key: "bottom", items: bottomItems, placement: "bottom", mode: "vertical"},
                  ]
        }, [
            bottomItems,
            filtered,
            phone,
            retry,
            sessions,
            sessionsActions,
            status,
            t,
            total,
            wrapSessionRow,
        ])
    }

    const Header = ({collapsed, onDismiss}: SidebarSlotContext) => {
        const t = useT(agentSidebarCatalog)
        const router = useRouter()
        const selected = useSelectedSidebar()
        return (
            <AgentSidebarHeader
                collapsed={collapsed}
                back={
                    <SidebarBackButton
                        collapsed={collapsed}
                        onBack={() => {
                            const fromAgents =
                                selected.kind === "agent" && selected.from === "agents"
                            openMainSidebar()
                            if (fromAgents) void router.push(`${projectURL}/agents`)
                        }}
                    />
                }
                toggle={<SidebarToggleButton onDismiss={onDismiss} />}
                switcher={
                    <ConnectedAgentSwitcher
                        projectURL={projectURL}
                        projectId={projectId}
                        current={{kind: "agent", agentId}}
                        collapsed={collapsed}
                    />
                }
                newSession={
                    <SidebarNewButton
                        label={t("agentSidebar.newSession")}
                        href={agentEntryHref(projectURL, agentId)}
                        collapsed={collapsed}
                        onPlainClick={() => startBlankSession(projectURL, agentId)}
                    />
                }
                onFold={openMainSidebar}
            />
        )
    }

    // Forwarded, or the switcher keeps its expanded padding inside the 48px rail.
    const AfterBottom = ({collapsed}: {collapsed: boolean}) =>
        useContext(SidebarLayoutContext) === "phone" ? null : (
            <DrawerProjectSwitcher
                workspaceId={workspaceId}
                projectId={projectId}
                collapsed={collapsed}
            />
        )

    const Footer = ({collapsed}: SidebarSlotContext) =>
        useContext(SidebarLayoutContext) === "phone" ? null : (
            <CreditsRemainingWidget
                projectId={projectId}
                settingsURL={`${projectURL}/settings`}
                collapsed={collapsed}
            />
        )

    return {
        id: `agent-sidebar:${agentId}`,
        useSelection,
        useSections,
        header: Header,
        footer: Footer,
        afterBottom: AfterBottom,
    }
}
