import {useCallback, useMemo} from "react"

import {chatPanelMaximizedAtom, configPanelCollapsedAtom} from "@agenta/chat/state"
import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useAtomValue, useSetAtom} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useStartBlankSession} from "../chat/useStartBlankSession"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {SessionAutomationDrawers} from "../sessions/SessionAutomationDrawers"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {AgentOverviewBody} from "./AgentOverviewBody"
import {AgentOverviewTitle} from "./AgentOverviewTitle"

/** One agent's overview: who it is, a composer, its activity in tabs, and its own state in a rail. */
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
    const description = agent?.description?.trim() || null
    const agentNames = useMemo(
        () => new Map(agents.map((entry) => [entry.id, entry.name || entry.slug || "Agent"])),
        [agents],
    )

    // The shared row verbs — rename, pin, archive, delete — bound here, resolved by the rows.
    const sessionMenu = useSessionRowMenu(base)
    const verbs = useMemo(
        () => ({
            open: sessionMenu.open,
            menuFor: sessionMenu.menuFor,
            onMenuSelect: sessionMenu.onMenuSelect,
            onRenameRow: sessionMenu.onRenameRow,
        }),
        [sessionMenu.menuFor, sessionMenu.onMenuSelect, sessionMenu.onRenameRow, sessionMenu.open],
    )

    const startBlank = useStartBlankSession(base)
    const openChat = useCallback(() => startBlank(agentId), [agentId, startBlank])
    // Configuration is edited in the session workspace here, so this lands on a blank session
    // with the config pane on screen. BOTH flags are written — either alone leaves it hidden.
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
                        // Phone chrome: a pinned strip over a scroller, whose rule stops at `lg`
                        // where the page is a centred column. Padding sits on the inner column so
                        // the header's left edge stays on the body's.
                        <div className="border-border shrink-0 border-b pb-3 pt-2 lg:border-b-0 lg:pb-5 lg:pt-14">
                            <div
                                className={`${pageContentWidthClass} flex items-start gap-2 px-4 lg:px-16`}
                            >
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <AgentOverviewTitle
                                    agentId={agentId}
                                    name={name}
                                    description={description}
                                    pending={agentsQuery.isPending && !agent}
                                    onOpenChat={openChat}
                                />
                            </div>
                        </div>
                    }
                >
                    {/* `min-h-0 flex-1` is load-bearing: the body IS the scroller. */}
                    <div
                        // The header's gutter less the 12px the body's scroller carries itself (see the body).
                        className={`${pageContentWidthClass} flex min-h-0 flex-1 flex-col px-1 pb-4 pt-3 lg:px-[52px] lg:pb-6 lg:pt-2`}
                    >
                        <AgentOverviewBody
                            agentId={agentId}
                            agentName={name}
                            base={base}
                            agentNames={agentNames}
                            verbs={verbs}
                            onEditConfig={onEditConfig}
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
            {/* Mounted at screen level so a drawer survives its row unmounting underneath it. */}
            <SessionAutomationDrawers base={base} />
        </>
    )
}
