import {createElement, useMemo} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {AgentChip} from "@agenta/entity-ui/agent"
import {
    sidebarSessionSearchLoadingAtom,
    sidebarSessionSearchResultsAtom,
    type SessionSidebarRef,
} from "@agenta/navigation"
import type {CommandPaletteEntry, CommandPaletteGroup} from "@agenta/navigation-ui"
import {getSettingsSidebarTabs} from "@agenta/settings"
import {
    ChatsCircleIcon,
    GearIcon,
    HouseIcon,
    LightningIcon,
    PlusIcon,
    PuzzlePieceIcon,
    RobotIcon,
    SquaresFourIcon,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {mobileSessionsEntity} from "./useMobileNavItems"

import {AVAILABLE_SETTINGS_TABS, useMobileSettingsAccess} from "@/features/settings/settingsTabs"
import {withMobileSettingsLabels} from "@/lib/integrationsCopy"

/** Case-insensitive substring over the label and any extra words. */
const matches = (query: string, label: string, keywords: string[] = []) =>
    [label, ...keywords].some((text) => text.toLowerCase().includes(query))

/** Rows the palette shows before anything is typed — enough to reach for, not a list. */
const RECENT_SESSIONS = 6
const RECENT_AGENTS = 5
/** Hits per group once a query narrows them; the list scrolls past this anyway. */
const MATCH_CAP = 8

const icon = (Icon: typeof HouseIcon) => createElement(Icon, {size: 14})

/**
 * What the palette can reach, by group, most-wanted first: sessions, agents, then the pages
 * and settings. Every source here is already in memory while the rail is up —
 * the session catalogue and the agent catalogue — except the typed session search, which the
 * rail's own server search answers. Automations and skills are not prefetched, so they are not
 * listed; automation runs are sessions and show up through the search.
 */
export const useCommandPaletteGroups = (
    projectURL: string,
    query: string,
): {groups: CommandPaletteGroup[]; loading: boolean} => {
    const q = query.trim().toLowerCase()
    const typed = q.length > 0

    const source = useAtomValue(mobileSessionsEntity.activeSourceAtom)
    const hits = useAtomValue(sidebarSessionSearchResultsAtom)
    const searching = useAtomValue(sidebarSessionSearchLoadingAtom)
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const access = useMobileSettingsAccess()

    const groups = useMemo<CommandPaletteGroup[]>(() => {
        const sessionRow = (ref: SessionSidebarRef): CommandPaletteEntry => ({
            key: ref.sessionId,
            label: mobileSessionsEntity.getLabel(ref),
            // At the rail's own size (an 8px dot, a 12px bolt): the row's svg rule would
            // otherwise scale the status glyph up to 16px. `!`, since that rule wins on
            // specificity.
            icon: createElement(
                "span",
                {className: "flex w-4 items-center justify-center [&_svg]:!size-auto"},
                mobileSessionsEntity.getIcon?.(ref),
            ),
            href: `${projectURL}/sessions/${ref.sessionId}`,
        })
        // Typed: the server's answer. Empty: what the rail already holds, pins leading.
        const sessions = typed
            ? hits.slice(0, MATCH_CAP).map(sessionRow)
            : (source.refs as SessionSidebarRef[]).slice(0, RECENT_SESSIONS).map(sessionRow)

        const agents = (agentsQuery.data ?? []).filter(
            (agent) => !typed || matches(q, agent.name ?? ""),
        )
        const agentRows: CommandPaletteEntry[] = agents
            .slice(0, typed ? MATCH_CAP : RECENT_AGENTS)
            .map((agent) => ({
                key: agent.id,
                label: agent.name || "Agent",
                // The agent's own avatar, as its rows draw it everywhere else.
                icon: createElement(AgentChip, {workflowId: agent.id, box: "size-5", glyph: 13}),
                href: `${projectURL}/agents/${agent.id}`,
            }))
        const pages: CommandPaletteEntry[] = [
            {key: "home", label: "Home", icon: icon(HouseIcon), href: `${projectURL}/apps`},
            {key: "agents", label: "Agents", icon: icon(RobotIcon), href: `${projectURL}/agents`},
            {
                key: "automations",
                label: "Automations",
                icon: icon(LightningIcon),
                href: `${projectURL}/automations`,
            },
            {
                key: "skills",
                label: "Skills",
                icon: icon(PuzzlePieceIcon),
                href: `${projectURL}/skills`,
            },
            {
                key: "sessions",
                label: "Sessions",
                icon: icon(ChatsCircleIcon),
                href: `${projectURL}/sessions`,
            },
            {
                key: "templates",
                label: "Templates",
                icon: icon(SquaresFourIcon),
                href: `${projectURL}/templates`,
            },
            {
                key: "settings",
                label: "Settings",
                icon: icon(GearIcon),
                href: `${projectURL}/settings`,
            },
        ].filter((page) => !typed || matches(q, page.label))

        // Settings tabs only once something is typed: the empty state is for sessions and agents.
        const settings: CommandPaletteEntry[] = typed
            ? withMobileSettingsLabels(
                  getSettingsSidebarTabs(access).filter(
                      (tab) => !tab.isHidden && AVAILABLE_SETTINGS_TABS.includes(tab.key),
                  ),
              )
                  .filter((tab) => matches(q, tab.title, ["settings"]))
                  .map((tab) => ({
                      key: tab.key,
                      label: tab.title,
                      icon: icon(GearIcon),
                      hint: "Settings",
                      href: `${projectURL}/settings?tab=${tab.key}`,
                  }))
            : []

        const actions: CommandPaletteEntry[] = [
            {
                key: "new-agent",
                label: "New agent",
                icon: icon(PlusIcon),
                href: `${projectURL}/agents/new`,
            },
            {
                key: "browse-templates",
                label: "Browse templates",
                icon: icon(SquaresFourIcon),
                href: `${projectURL}/templates`,
            },
        ].filter((action) => !typed || matches(q, action.label, ["create", "add"]))

        return [
            {key: "sessions", heading: "Sessions", entries: sessions},
            {key: "agents", heading: "Agents", entries: agentRows},
            {key: "pages", heading: "Pages", entries: pages},
            {key: "settings", heading: "Settings", entries: settings},
            {key: "actions", heading: "Actions", entries: actions},
        ]
    }, [access, agentsQuery.data, hits, projectURL, q, source.refs, typed])

    return {groups, loading: typed && searching}
}
