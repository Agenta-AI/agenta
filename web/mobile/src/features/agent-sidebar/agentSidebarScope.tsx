import {useCallback, useMemo} from "react"

import {sessionListQueryOptions} from "@agenta/entities/session"
import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {livePollInterval} from "@agenta/navigation"
import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SidebarBackButton, SidebarToggleButton} from "@agenta/navigation-ui"
import {sessionRowVm} from "@agenta/sessions/row"
import {pendingBySessionId, useActionableInteractions} from "@agenta/sessions/state"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import Router, {useRouter} from "next/router"

import {agentEntryHref} from "../agents/agentEntry"
import {startBlankSession} from "../chat/useStartBlankSession"
import {DrawerProjectSwitcher} from "../nav/DrawerProjectSwitcher"
import {useMobileBottomNavItems, useRailSessionRowWrapper} from "../nav/useMobileNavItems"
import {CreditsRemainingWidget} from "../wallet/CreditsRemainingWidget"

import {AgentSidebarHeader} from "./AgentSidebarHeader"
import {
    agentSidebarItems,
    agentSidebarSelectedKey,
    type AgentSidebarSession,
} from "./agentSidebarItems"
import {AgentSidebarSwitcher} from "./AgentSidebarSwitcher"
import {
    currentSidebar,
    openAgentSidebar,
    openMainSidebar,
    useSelectedSidebar,
} from "./selectedSidebar"
import {switchTarget} from "./switchAgent"

/** How many latest sessions the agent sidebar lists; "Show N older sessions" opens the rest. */
export const AGENT_SIDEBAR_SESSION_LIMIT = 10

/** The first page of one agent's session list, with the total. Under the list's own key prefix,
 * so renames, archives and new turns refresh it too. */
const agentSessionsQuery = (projectId: string, agentId: string, limit: number) => {
    const options = sessionListQueryOptions({projectId, agentId, includeTotal: true, limit})
    return {
        queryKey: [...options.queryKey, "first-page"],
        queryFn: async ({signal}: {signal?: AbortSignal}) => {
            const page = await options.queryFn({pageParam: null, signal})
            // An error, not an empty list: a failed refresh keeps the rows it had.
            if (!page) throw new Error("The session list did not load")
            return page
        },
        staleTime: 30_000,
    }
}

/** The agent's latest sessions and the count of all its sessions, in one request. */
const useAgentSessions = (projectId: string, agentId: string) => {
    const query = useQuery({
        ...agentSessionsQuery(projectId, agentId, AGENT_SIDEBAR_SESSION_LIMIT),
        enabled: Boolean(projectId),
        refetchOnWindowFocus: true,
        // The main sidebar's cadence: faster while a session runs or is alive.
        refetchInterval: (query) => livePollInterval(query.state.data?.sessions),
    })
    const interactions = useActionableInteractions(projectId)
    const pending = useMemo(() => pendingBySessionId(interactions.data), [interactions.data])
    const sessions = useMemo(
        () =>
            (query.data?.sessions ?? []).map((row): AgentSidebarSession => {
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
        [pending, query.data?.sessions],
    )
    const status = query.isPending ? "loading" : query.isError ? "error" : "ready"
    return {sessions, total: query.data?.total ?? null, status} as const
}

/**
 * The switcher, connected: the agents the person can see, and a pick that keeps the same kind
 * of page (see `switchTarget`) and shows the picked agent's sidebar.
 */
const ConnectedSwitcher = ({
    projectURL,
    projectId,
    agentId,
    collapsed,
}: {
    projectURL: string
    projectId: string
    agentId: string
    collapsed: boolean
}) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const selected = useSelectedSidebar()
    const agents = useAtomValue(agentWorkflowsListQueryStateAtom).data
    const onPick = useCallback(
        async (pickedAgentId: string) => {
            const fromPath = router.asPath
            const choice = openAgentSidebar(
                pickedAgentId,
                selected.kind === "agent" ? selected.from : "main",
            )
            let href: string | null
            try {
                href = await switchTarget({
                    projectURL,
                    pathname: router.pathname,
                    query: router.query,
                    pickedAgentId,
                    latestSessionId: async (id) => {
                        const page = await queryClient.fetchQuery(
                            agentSessionsQuery(projectId, id, 1),
                        )
                        return page.sessions[0]?.session_id ?? null
                    },
                })
            } catch {
                // The lookup failed: the agent sidebar shows, and the page stays.
                return
            }
            // Any later sidebar choice (a pick, Fold, Back, an open button) or a move to another
            // page replaced this one.
            if (currentSidebar() !== choice || Router.asPath !== fromPath) return
            if (href) void router.push(href)
            else startBlankSession(projectURL, pickedAgentId)
        },
        [projectId, projectURL, queryClient, router, selected],
    )
    return (
        <AgentSidebarSwitcher
            agents={agents}
            agentId={agentId}
            collapsed={collapsed}
            onPick={(id) => void onPick(id)}
        />
    )
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

    const useSelection = (): SidebarSelection => {
        const router = useRouter()
        const selectedKeyOverride = agentSidebarSelectedKey(router.query, agentId)
        return useMemo(
            () => (selectedKeyOverride ? {mode: "route", selectedKeyOverride} : {mode: "route"}),
            [selectedKeyOverride],
        )
    }

    const useSections = (): SidebarSection[] => {
        const t = useT(agentSidebarCatalog)
        const bottomItems = useMobileBottomNavItems(projectURL)
        const wrapSessionRow = useRailSessionRowWrapper(projectURL)
        const {sessions, total, status} = useAgentSessions(projectId, agentId)

        return useMemo(
            () => [
                {
                    key: "agent",
                    items: agentSidebarItems({
                        projectURL,
                        agentId,
                        sessions,
                        total,
                        status,
                        t,
                        newSessionHref: agentEntryHref(projectURL, agentId),
                        onNewSession: (event) => {
                            event.preventDefault()
                            startBlankSession(projectURL, agentId)
                        },
                        wrapSessionRow,
                    }),
                },
                {key: "bottom", items: bottomItems, placement: "bottom", mode: "vertical"},
            ],
            [bottomItems, sessions, status, t, total, wrapSessionRow],
        )
    }

    const Header = ({collapsed, onDismiss}: SidebarSlotContext) => {
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
                    <ConnectedSwitcher
                        projectURL={projectURL}
                        projectId={projectId}
                        agentId={agentId}
                        collapsed={collapsed}
                    />
                }
                onFold={openMainSidebar}
            />
        )
    }

    // Forwarded, or the switcher keeps its expanded padding inside the 48px rail.
    const AfterBottom = ({collapsed}: {collapsed: boolean}) => (
        <DrawerProjectSwitcher
            workspaceId={workspaceId}
            projectId={projectId}
            collapsed={collapsed}
        />
    )

    const Footer = ({collapsed}: SidebarSlotContext) => (
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
