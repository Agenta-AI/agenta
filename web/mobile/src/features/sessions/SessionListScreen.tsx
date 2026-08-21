import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {useSessionsList} from "@agenta/sessions/state"
import {SessionFiltersBar, SessionFiltersPanel, SessionsListView} from "@agenta/sessions-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {BROWSE_RAIL_MODE} from "@/lib/browseLayout"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {useSessionRowMenu} from "./useSessionRowMenu"

/**
 * The sessions page — the SAME shared body and filters toolbar the desktop page renders
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
    const list = useSessionsList({
        defaultPolicy: {origin: "exclude-trigger", expansions: []},
        automationPolicy: {origin: "trigger-only", expansions: ["trigger"]},
    })
    // The shared row verbs — rename, pin, archive, delete — the same ones the agent overview and
    // the desktop list bind. Without them a row here offers only the pin.
    const sessionMenu = useSessionRowMenu(`/w/${workspaceId}/p/${projectId}`)
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo(
        () =>
            (agentsQuery.data ?? []).map((agent: Workflow) => ({
                id: agent.id,
                name: agent.name || agent.slug || "Agent",
            })),
        [agentsQuery.data],
    )

    // The same list either way — only what wraps it changes.
    const sessionsList = (
        <SessionsListView
            onOpenRow={sessionMenu.open}
            menuFor={sessionMenu.menuFor}
            onMenuSelect={sessionMenu.onMenuSelect}
            revealActionsOnHover={false}
            className={`${pageContentWidthClass} min-h-0 flex-1 overflow-y-auto px-4 pb-6 lg:px-16`}
        />
    )

    return (
        <>
            <PageTitle title="Sessions" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                {/* The toolbar is the default (#5833) — beside this app's nav rail a filter rail
                    is the second sidebar that PR removed. With the flag on, the rail returns as
                    it always behaved here: the compact bar on a phone, the rail from `lg` up. */}
                <ScreenScaffold
                    fill
                    header={
                        <SessionFiltersBar
                            className={
                                BROWSE_RAIL_MODE
                                    ? "lg:hidden"
                                    : `${pageContentWidthClass} lg:px-16 lg:pt-14`
                            }
                            leading={<NavDrawer workspaceId={workspaceId} projectId={projectId} />}
                            title="Sessions"
                            waitingCount={list.waitingCount}
                            agents={agents}
                        />
                    }
                >
                    {BROWSE_RAIL_MODE ? (
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
                            {sessionsList}
                        </FilterRailLayout>
                    ) : (
                        sessionsList
                    )}
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
