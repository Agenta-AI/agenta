import {createElement, useMemo} from "react"

import {useT} from "@agenta/i18n"
import agentSidebarCatalog from "@agenta/i18n/catalogs/agentSidebar"
import agentSectionsCatalog from "@agenta/i18n/catalogs/nav.agentSections"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {
    SidebarBackButton,
    SidebarLogo,
    SidebarShell,
    SidebarToggleButton,
    type NavItem,
} from "@agenta/navigation-ui"
import {
    ChatsCircleIcon,
    CircleIcon,
    CompassIcon,
    HouseIcon,
    LightningIcon,
    RobotIcon,
} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {atom, type PrimitiveAtom} from "jotai"

import {AgentSidebarHeader} from "../../../../mobile/src/features/agent-sidebar/AgentSidebarHeader"
import {agentSidebarItems} from "../../../../mobile/src/features/agent-sidebar/agentSidebarItems"
import {AgentSidebarSwitcher} from "../../../../mobile/src/features/agent-sidebar/AgentSidebarSwitcher"
import {
    MAIN_SECTIONS,
    OPEN_SESSION_ID,
    SIDEBARS_AGENTS,
    SIDEBARS_PROJECT_URL as P,
    SUPPORT_TRIAGE,
    SUPPORT_TRIAGE_SESSIONS,
    SUPPORT_TRIAGE_TOTAL,
} from "../../../fixtures/builderLayout/sidebars"

/** The main sidebar's agent sections list this many sessions (`AGENT_SECTION_SESSION_LIMIT`). */
const SECTION_SESSIONS = 4

const collapsedAtom = atom(false)
const openGroups = new Map<string, PrimitiveAtom<string[] | undefined>>()
const openGroupsAtomFamily = (scopeId: string) => {
    if (!openGroups.has(scopeId)) openGroups.set(scopeId, atom<string[] | undefined>(undefined))
    return openGroups.get(scopeId)!
}
const ROUTE = {mode: "route"} as const
const noop = () => undefined

const Rail = ({
    scope,
    currentPath,
}: {
    scope: Parameters<typeof SidebarShell>[0]["scope"]
    currentPath: string
}) => (
    <div style={{height: 760, display: "flex"}} data-testid="sidebar-story">
        <SidebarShell
            collapsedAtom={collapsedAtom}
            openGroupsAtomFamily={openGroupsAtomFamily}
            currentPath={currentPath}
            scope={scope}
        />
    </div>
)

/** The Main frame: one section per agent with its 4 latest sessions, "+" and open on hover. */
const mainScope = {
    id: "story-main",
    useSelection: () => ROUTE,
    useSections: () => {
        const t = useT(navigationCatalog, agentSectionsCatalog)
        return useMemo(() => {
            const sessions: NavItem[] = MAIN_SECTIONS.flatMap(({agent, sessions}) => [
                {
                    key: `group-${agent.id}`,
                    title: agent.name,
                    isGroupLabel: true,
                    onClick: noop,
                    groupAdd: {
                        link: `${P}/agents/${agent.id}`,
                        label: t("navigation.items.newSessionWith", {agent: agent.name}),
                    },
                    groupEnter: {
                        label: t("nav.agentSections.openAgent", {agent: agent.name}),
                        onClick: noop,
                    },
                },
                ...sessions.slice(0, SECTION_SESSIONS).map(
                    (title, index): NavItem => ({
                        key: `${agent.id}-${index}`,
                        title,
                        icon: createElement(CircleIcon, {size: 8}),
                        link: `${P}/sessions/${agent.id}-${index}`,
                    }),
                ),
            ])
            const items: NavItem[] = [
                {
                    key: "home",
                    title: t("navigation.items.home"),
                    icon: <HouseIcon size={16} />,
                    link: `${P}/apps`,
                },
                {
                    key: "agents",
                    title: t("navigation.items.agents"),
                    icon: <RobotIcon size={16} />,
                    link: `${P}/agents`,
                },
                {
                    key: "automations",
                    title: t("navigation.items.automations"),
                    icon: <LightningIcon size={16} />,
                    link: `${P}/automations`,
                },
                {
                    key: "skills",
                    title: t("navigation.items.skills"),
                    icon: <CompassIcon size={16} />,
                    link: `${P}/skills`,
                },
                {
                    key: "sessions",
                    title: t("navigation.items.sessions"),
                    icon: <ChatsCircleIcon size={16} />,
                    link: `${P}/sessions`,
                    alwaysOpen: true,
                    scrollChildren: true,
                    submenu: sessions,
                },
            ]
            return [{key: "project", items}]
        }, [t])
    },
    header: ({collapsed}: {collapsed: boolean}) => (
        <SidebarLogo
            collapsed={collapsed}
            toggle={<SidebarToggleButton collapsedAtom={collapsedAtom} />}
        />
    ),
}

/** The A01 frame: the agent sidebar of "Support triage" on one of its sessions. */
const agentScope = {
    id: "story-agent",
    useSelection: () => ROUTE,
    useSections: () => {
        const t = useT(agentSidebarCatalog)
        return useMemo(
            () => [
                {
                    key: "agent",
                    items: agentSidebarItems({
                        projectURL: P,
                        agentId: SUPPORT_TRIAGE.id,
                        sessions: SUPPORT_TRIAGE_SESSIONS,
                        total: SUPPORT_TRIAGE_TOTAL,
                        t,
                    }),
                },
            ],
            [t],
        )
    },
    header: ({collapsed}: {collapsed: boolean}) => (
        <AgentSidebarHeader
            collapsed={collapsed}
            back={<SidebarBackButton collapsed={collapsed} onBack={noop} />}
            toggle={<SidebarToggleButton collapsedAtom={collapsedAtom} />}
            switcher={
                <AgentSidebarSwitcher
                    agents={SIDEBARS_AGENTS}
                    agentId={SUPPORT_TRIAGE.id}
                    collapsed={collapsed}
                    onPick={noop}
                />
            }
            onFold={noop}
        />
    ),
}

const meta = {
    title: "BuilderLayout/Main and A01 sidebars",
    component: Rail,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The main sidebar with one section per agent (canvas Main) and the agent sidebar (canvas A01). Fixture data; no backend.",
            },
        },
    },
} satisfies Meta<typeof Rail>

export default meta
type Story = StoryObj<typeof meta>

export const MainSidebar: Story = {
    args: {scope: mainScope, currentPath: `${P}/sessions/${SUPPORT_TRIAGE.id}-0`},
}

/** The first agent heading under the pointer: "+" and the open button show. */
export const MainSidebarHeadingHover: Story = {
    args: MainSidebar.args,
    parameters: {pseudo: {hover: [`[data-sticky-heading="true"]`]}},
}

export const AgentSidebar: Story = {
    args: {scope: agentScope, currentPath: `${P}/sessions/${OPEN_SESSION_ID}`},
}
