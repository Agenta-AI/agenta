import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {NextTriggersSection} from "@agenta/entity-ui/agent"
import {AgentsPanel, HomeOverview, UsageCard, type AgentsPanelEntry} from "@agenta/home-ui"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {NewAgentAction} from "../agents/NewAgentAction"
import {useNewAgentAction} from "../agents/useNewAgentAction"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {HomeComposer} from "./HomeComposer"
import {HomeSectionEmpty} from "./states/HomeStates"

/**
 * The project's home — the SHARED page (`@agenta/home-ui`), the same one the desktop app
 * renders: the hero, then what is in flight (sessions, automation runs), with what you could
 * start (agents, next triggers, usage) in the rail beside it at lg and beneath it on a phone.
 *
 * The composer mints a session id, stashes the task and navigates to the chat route, which is
 * where the conversation engine lives — the first send is what creates the session server-side.
 */
export const HomeScreen = ({workspaceId, projectId}: {workspaceId: string; projectId: string}) => {
    useBindProjectContext(projectId)
    const project = useCurrentProject(workspaceId, projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const router = useRouter()
    const sessionMenu = useSessionRowMenu(base)
    const newAgent = useNewAgentAction(base)
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])
    const agentNames = useMemo(
        () => new Map(agents.map((agent) => [agent.id, agent.name || agent.slug || "Agent"])),
        [agents],
    )

    // Rename/archive/playground have no mobile surface, so their menu entries are simply not
    // offered — the card renders without them rather than with dead actions.
    const agentEntries = useMemo<AgentsPanelEntry[]>(
        () =>
            agents.map((agent) => ({
                agent: {
                    id: agent.id,
                    name: agent.name || agent.slug || "Untitled agent",
                    description: agent.description,
                    updatedAt: agent.updated_at ?? undefined,
                },
                createdAt: agent.created_at ?? undefined,
                onOpenOverview: () => void router.push(`${base}/agents/${agent.id}`),
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [agents, base],
    )

    return (
        <>
            <PageTitle parts={["Home", project?.project_name]} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 pb-3 pt-2 lg:hidden">
                            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                            <h1 className="m-0 text-sm font-semibold">
                                {project?.project_name ?? "Home"}
                            </h1>
                        </div>
                    }
                >
                    <HomeOverview
                        title="What do you want to do?"
                        action={
                            <NewAgentAction
                                create={() => void newAgent.create()}
                                createFromTemplate={newAgent.createFromTemplate}
                                base={base}
                                align="end"
                                creating={newAgent.creating}
                                error={newAgent.error}
                            />
                        }
                        composer={
                            agents.length > 0 ? <HomeComposer agents={agents} base={base} /> : null
                        }
                        sessionsHref={`${base}/sessions`}
                        onOpenSession={sessionMenu.open}
                        sessionMenuFor={sessionMenu.menuFor}
                        onSessionMenuSelect={sessionMenu.onMenuSelect}
                        alwaysShowPin
                        agentsPanel={
                            <AgentsPanel
                                entries={agentEntries}
                                loading={agentsQuery.isPending}
                                allAgentsHref={`${base}/agents`}
                                onNewAgent={() => void newAgent.create()}
                                empty={
                                    <HomeSectionEmpty text="Agents you create will show up here." />
                                }
                            />
                        }
                        triggersPanel={<NextTriggersSection agentNames={agentNames} />}
                        usagePanel={<UsageCard />}
                    />
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
