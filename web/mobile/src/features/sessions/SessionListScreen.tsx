import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import type {SessionRowVm} from "@agenta/sessions/row"
import {useSessionsList} from "@agenta/sessions/state"
import {SessionFiltersBar, SessionFiltersPanel, SessionsListView} from "@agenta/sessions-ui"
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

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
                {/* Two shells over the same filter atoms, swapped at `lg`: the rail beside the
                    results where there is room, the compact bar on a phone — where the rail's
                    stacked facets are most of the viewport and the list starts below the fold. */}
                <ScreenScaffold
                    fill
                    header={
                        <SessionFiltersBar
                            className="lg:hidden"
                            leading={<NavDrawer workspaceId={workspaceId} projectId={projectId} />}
                            title="Sessions"
                            waitingCount={list.waitingCount}
                            agents={agents}
                        />
                    }
                >
                    <FilterRailLayout
                        railClassName="hidden lg:flex"
                        rail={
                            <SessionFiltersPanel
                                title="Sessions"
                                waitingCount={list.waitingCount}
                                agents={agents}
                            />
                        }
                    >
                        <SessionsListView
                            onOpenRow={openRow}
                            revealActionsOnHover={false}
                            className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 lg:px-6"
                        />
                    </FilterRailLayout>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
