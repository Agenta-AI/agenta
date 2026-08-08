import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import type {SessionRowVm} from "@agenta/sessions/row"
import {useSessionsList} from "@agenta/sessions/state"
import {SessionFiltersPanel, SessionsListView} from "@agenta/sessions-ui"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

/**
 * The sessions page — the SAME shared body and filters panel the desktop page renders
 * (`@agenta/sessions-ui`): one organisation (groups, pins, filters, paging), mobile's shell.
 * Touch keeps row actions always visible (no hover); rows open the mobile chat route.
 */
export const SessionListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const project = useCurrentProject(workspaceId, projectId)
    const router = useRouter()
    const list = useSessionsList()
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo(
        () =>
            (agentsQuery.data ?? []).map((agent: Workflow) => ({
                id: agent.id,
                name: agent.name || agent.slug || "Agent",
            })),
        [agentsQuery.data],
    )

    const openRow = (vm: SessionRowVm) =>
        void router.push(`/w/${workspaceId}/p/${projectId}/sessions/${vm.id}`)

    return (
        <>
            <PageTitle parts={["Sessions", project?.project_name]} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="border-border shrink-0 border-b px-4 pb-3 pt-2 lg:hidden">
                            <ContentRail className="flex items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 text-sm font-semibold">Sessions</h1>
                            </ContentRail>
                        </div>
                    }
                >
                    <div className="flex min-h-0 w-full flex-1 flex-col lg:flex-row">
                        <SessionFiltersPanel
                            title="Sessions"
                            waitingCount={list.waitingCount}
                            agents={agents}
                        />
                        <SessionsListView
                            onOpenRow={openRow}
                            revealActionsOnHover={false}
                            className="min-h-0 flex-1 px-4 pb-6 lg:overflow-y-auto lg:px-6"
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
