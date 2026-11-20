import {useCallback, useContext, useMemo} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import {livePollInterval} from "@agenta/navigation"
import type {
    SidebarScope,
    SidebarSection,
    SidebarSelection,
    SidebarSlotContext,
} from "@agenta/navigation"
import {SidebarBackButton, SidebarLayoutContext, SidebarToggleButton} from "@agenta/navigation-ui"
import {sessionRowVm} from "@agenta/sessions/row"
import {pendingBySessionId, useActionableInteractions} from "@agenta/sessions/state"
import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {agentEntryHref} from "../agents/agentEntry"
import {startBlankSession} from "../chat/useStartBlankSession"
import {DrawerProjectSwitcher} from "../nav/DrawerProjectSwitcher"
import {useMobileBottomNavItems, useRailSessionRowWrapper} from "../nav/useMobileNavItems"
import {CreditsRemainingWidget} from "../wallet/CreditsRemainingWidget"

import {agentSessionsQuery} from "./agentSessionsQuery"
import {AgentSidebarHeader} from "./AgentSidebarHeader"
import {
    agentSidebarItems,
    agentSidebarSelectedKey,
    type AgentSidebarSession,
} from "./agentSidebarItems"
import {ConnectedAgentSwitcher} from "./ConnectedAgentSwitcher"
import {openMainSidebar, useSelectedSidebar} from "./selectedSidebar"
import {SidebarNewButton} from "./SidebarNewButton"

/** How many latest sessions the agent sidebar lists; "Show N older sessions" opens the rest. */
export const AGENT_SIDEBAR_SESSION_LIMIT = 10

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
    const {refetch} = query
    const retry = useCallback(() => void refetch(), [refetch])
    return {sessions, total: query.data?.total ?? null, status, retry} as const
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

    // The phone sheet ends after the session list: no Templates, Settings, workspace switcher,
    // credits or row menus there (M02).
    const useSections = (): SidebarSection[] => {
        const t = useT(agentSidebarCatalog)
        const phone = useContext(SidebarLayoutContext) === "phone"
        const bottomItems = useMobileBottomNavItems(projectURL)
        const wrapSessionRow = useRailSessionRowWrapper(projectURL)
        const {sessions, total, status, retry} = useAgentSessions(projectId, agentId)

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
                }),
            }
            return phone
                ? [agent]
                : [
                      agent,
                      {key: "bottom", items: bottomItems, placement: "bottom", mode: "vertical"},
                  ]
        }, [bottomItems, phone, retry, sessions, status, t, total, wrapSessionRow])
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
