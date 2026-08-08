import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {
    AgentConfigSummaryCard,
    agentAvatar,
    AgentOverviewLayout,
    NextTriggersSection,
} from "@agenta/entity-ui/agent"
import {SessionCardList} from "@agenta/sessions-ui"
import {useAtomValue} from "jotai"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {AgentOverviewSection} from "./AgentOverviewSection"

/**
 * One agent's overview — the mobile face of the desktop agent overview page: this agent's
 * sessions and automation runs from the same shared card hooks, and the shared read-only
 * configuration card in place of the desktop's rail. Read-only host: configuration is edited
 * in the desktop playground, so the card gets no `onEdit`.
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
    const agentNames = useMemo(
        () => new Map(agents.map((entry) => [entry.id, entry.name || entry.slug || "Agent"])),
        [agents],
    )

    const sessionMenu = useSessionRowMenu(base)

    return (
        <>
            <PageTitle parts={[name, "Agents"]} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="border-border shrink-0 border-b px-2 pb-3 pt-2">
                            <ContentRail className="flex items-center gap-2 lg:max-w-none">
                                {/* Nav is the drawer, as on every other screen — not a per-screen
                                    back button. Home is one drawer entry away. */}
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <span
                                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
                                    style={{backgroundColor: avatar.color}}
                                >
                                    {avatar.initials}
                                </span>
                                <h1 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
                                    {name}
                                </h1>
                            </ContentRail>
                        </div>
                    }
                >
                    {/* The SHARED arrangement the desktop overview uses — activity left, the
                        agent's own state as a rail. `gap-0` below lg keeps the phone's stacked
                        rhythm, which the sections already own through their own padding. */}
                    <ContentRail className="lg:max-w-none">
                        <AgentOverviewLayout
                            className="gap-0 lg:gap-6"
                            main={
                                <>
                                    <AgentOverviewSection
                                        title="Sessions"
                                        viewAllHref={`${base}/sessions`}
                                    >
                                        <div className="px-2">
                                            <SessionCardList
                                                withPinned
                                                agentId={agentId}
                                                limit={6}
                                                emptyText="Conversations with this agent will show up here."
                                                onOpenRow={sessionMenu.open}
                                                menuFor={sessionMenu.menuFor}
                                                onMenuSelect={sessionMenu.onMenuSelect}
                                                alwaysShowPin
                                            />
                                        </div>
                                    </AgentOverviewSection>

                                    <AgentOverviewSection title="Automation runs">
                                        <div className="px-2">
                                            <SessionCardList
                                                origin="trigger"
                                                agentId={agentId}
                                                limit={5}
                                                emptyText="Runs from automations bound to this agent will show up here."
                                                onOpenRow={sessionMenu.open}
                                                menuFor={sessionMenu.menuFor}
                                                onMenuSelect={sessionMenu.onMenuSelect}
                                                alwaysShowPin
                                            />
                                        </div>
                                    </AgentOverviewSection>
                                </>
                            }
                            rail={
                                <>
                                    {/* Scoped to this agent; automation RUNS say what already happened. */}
                                    <div className="px-2 pt-2 lg:pt-0">
                                        <NextTriggersSection
                                            agentId={agentId}
                                            agentNames={agentNames}
                                        />
                                    </div>

                                    <div className="px-2 pb-6 pt-2">
                                        <AgentConfigSummaryCard appId={agentId} />
                                    </div>
                                </>
                            }
                        />
                    </ContentRail>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
