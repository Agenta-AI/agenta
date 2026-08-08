import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {AgentOverviewBody, agentAvatar} from "@agenta/entity-ui/agent"
import {useAtomValue} from "jotai"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

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
                    fill
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
                    {/* THE shared overview body — the same cards, order and chrome the desktop
                        page renders. Read-only host: configuration is edited in the desktop
                        playground, so no `onEditConfig`. */}
                    <ContentRail className="min-h-0 flex-1 px-2 lg:max-w-none">
                        <AgentOverviewBody
                            alwaysShowPin
                            agentId={agentId}
                            agentNames={agentNames}
                            sessionsHref={`${base}/sessions`}
                            onOpenRow={sessionMenu.open}
                            menuFor={sessionMenu.menuFor}
                            onMenuSelect={sessionMenu.onMenuSelect}
                        />
                    </ContentRail>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
