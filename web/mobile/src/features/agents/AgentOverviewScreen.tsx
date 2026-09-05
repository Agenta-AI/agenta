import {useCallback, useMemo} from "react"

import {chatPanelMaximizedAtom, configPanelCollapsedAtom} from "@agenta/chat/state"
import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {
    AgentActionsMenu,
    AgentOverviewBody,
    agentAvatar,
    useAgentIconChrome,
} from "@agenta/entity-ui/agent"
import {UsageCard} from "@agenta/home-ui"
import {sessionRouteModes} from "@agenta/sessions/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useAtomValue, useSetAtom} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {Skeleton} from "@/components/ui/skeleton"

import {useStartBlankSession} from "../chat/useStartBlankSession"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {SessionAutomationDrawers} from "../sessions/SessionAutomationDrawers"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {AgentComposer} from "./AgentComposer"
import {AgentIconPopover} from "./AgentIconPopover"

/**
 * One agent's overview — the mobile face of the desktop agent overview page: this agent's
 * sessions and automation runs from the same shared card hooks, and the shared configuration
 * card in place of the desktop's rail. "Edit configuration" opens the session workspace's config
 * pane — this app's answer to the desktop's playground.
 */
export const AgentOverviewScreen = ({
    workspaceId,
    projectId,
    agentId,
}: {
    workspaceId: string
    projectId: string
    agentId: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`

    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])
    const agent = agents.find((candidate) => candidate.id === agentId)
    const name = agent?.name || agent?.slug || "Agent"
    const avatar = agentAvatar(name, agentId)
    const chrome = useAgentIconChrome(agentId, {
        size: 16,
        fallbackGlyph: avatar.initials,
        fallbackClassName: "text-white",
    })
    const agentNames = useMemo(
        () => new Map(agents.map((entry) => [entry.id, entry.name || entry.slug || "Agent"])),
        [agents],
    )

    const sessionMenu = useSessionRowMenu(base)

    // Configuration is edited in the session workspace here, so this lands on a blank session
    // with this agent and puts the config pane on screen. BOTH panel flags are written because
    // either one alone leaves the pane hidden — the pair `resolveSessionPanes` reads.
    const startBlank = useStartBlankSession(base)
    const setChatMaximized = useSetAtom(chatPanelMaximizedAtom)
    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)
    const onEditConfig = useCallback(() => {
        setChatMaximized(false)
        setConfigCollapsed(false)
        startBlank(agentId)
    }, [agentId, setChatMaximized, setConfigCollapsed, startBlank])

    return (
        <>
            <PageTitle title="Agents" context={name} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    header={
                        // The rule is phone chrome — a pinned strip over a scroller — so it stops
                        // at `lg`, where a full-bleed line would run edge to edge across a page
                        // whose content is a centred column, cutting it off from its own title.
                        // Same border story as the sessions bar.
                        //
                        // Horizontal padding sits on the inner column, not here: on the outer box
                        // it insets the box the column centres in, and the header's left edge
                        // drifts off the body's by half the padding.
                        <div className="border-border shrink-0 border-b pb-3 pt-2 lg:border-b-0 lg:pb-4 lg:pt-14">
                            <div
                                className={`${pageContentWidthClass} flex items-center gap-2 px-2 lg:px-16`}
                            >
                                {/* Nav is the drawer, as on every other screen — not a per-screen
                                    back button. Home is one drawer entry away. */}
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                {/* The one place the icon is editable. /m is a read-only host for
                                    agent CONFIG, but the icon is a local display preference, not
                                    configuration. */}
                                {/* The same popover the session top bar anchors. */}
                                <AgentIconPopover workflowId={agentId}>
                                    <span
                                        // ::after hit extender — 28px is under the touch guideline.
                                        className={`relative flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold after:absolute after:-inset-1.5 after:content-[''] ${chrome.className}`}
                                        style={chrome.style ?? {backgroundColor: avatar.color}}
                                    >
                                        {chrome.glyph}
                                    </span>
                                </AgentIconPopover>
                                {/* No `flex-1`: the title sizes to its text so the kebab sits
                                    beside it, as on the desktop, instead of being pushed to the
                                    far edge. `min-w-0` still lets a long name truncate. */}
                                {/* The heading-3 rung (24px/1.3333) every other title in this app
                                    gets — Sessions, Agents, Templates. At `text-sm` the agent's
                                    name read as a breadcrumb, so the page had no title at all. */}
                                {/* The "Agent" fallback is for an agent that never resolves; while
                                    the roster is still in flight it read as a real name. */}
                                {agentsQuery.isPending && !agent ? (
                                    <Skeleton className="h-8 w-40 shrink-0" />
                                ) : (
                                    <h1 className="text-colorText m-0 min-w-0 truncate text-[24px] font-semibold leading-[1.3333333333333333]">
                                        {name}
                                    </h1>
                                )}
                                {/* The same verbs the desktop header offers; rename and delete
                                    fall through to the shared implementations here, since /m has
                                    no app-management modals of its own.

                                    Held back until the record lands, like every other agent fact
                                    on this screen: until then `name` is the "Agent" placeholder,
                                    so a rename would open seeded with it and the destructive
                                    verbs would act on an agent whose name and slug are unknown. */}
                                {agent ? (
                                    <AgentActionsMenu
                                        agent={{id: agentId, name, slug: agent.slug}}
                                    />
                                ) : null}
                            </div>
                        </div>
                    }
                >
                    {/* THE shared overview body — the same cards, order and chrome the desktop
                        page renders. */}
                    {/* The shared page column (`pageContentWidthClass`), same as Sessions and
                        Agents: this page used to opt out of the cap at `lg` and stretched ~300px
                        wider than every other screen, which also inflated the body's right rail
                        past the width its rows are designed for. */}
                    {/* `min-h-0 flex-1` is load-bearing: the body IS the scroller, so it needs a
                        definite height to scroll within. */}
                    <div
                        className={`${pageContentWidthClass} flex min-h-0 flex-1 flex-col px-2 pb-4 pt-2 lg:px-16 lg:pb-6 lg:pt-5`}
                    >
                        {/* `sessionsHref` is the PROJECT-wide list — /m has no agent-scoped
                            sessions route — hence no `sessionsHrefScopesAgent`: the cards hand
                            this agent over as a filter, or "View all" lands on a list of
                            everyone else's sessions too. */}
                        <AgentOverviewBody
                            alwaysShowPin
                            composer={
                                <AgentComposer agentId={agentId} agentName={name} base={base} />
                            }
                            agentId={agentId}
                            agentNames={agentNames}
                            usage={<UsageCard appId={agentId} />}
                            sessionsHref={`${base}/sessions`}
                            automationSessionsHref={`${base}/sessions?mode=${sessionRouteModes.automation}`}
                            onEditConfig={onEditConfig}
                            onOpenRow={sessionMenu.open}
                            menuFor={sessionMenu.menuFor}
                            onMenuSelect={sessionMenu.onMenuSelect}
                            onRenameRow={sessionMenu.onRenameRow}
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
            {/* Mounted at screen level so a drawer survives its row unmounting underneath it. */}
            <SessionAutomationDrawers base={base} />
        </>
    )
}
