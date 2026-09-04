import {useMemo} from "react"

import {
    agentRosterSearchAtom,
    agentWorkflowsListQueryStateAtom,
    matchesAgentQuery,
} from "@agenta/entities/workflow"
import {AgentRosterGrid, useAgentActions, type AgentRosterEntry} from "@agenta/entity-ui/agent"
import {useWaitingByAgent} from "@agenta/sessions/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {SearchInput} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {BROWSE_RAIL_MODE} from "@/lib/browseLayout"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {NewAgentAction} from "./NewAgentAction"
import {useNewAgentAction} from "./useNewAgentAction"

/**
 * The full agent roster — where the nav's Agents entry lands.
 *
 * The roster IS the shared `AgentRosterGrid`: the same cards, waiting badge, create cell and empty
 * state the desktop Agents page renders, with the same rename and archive verbs from the shared
 * `useAgentActions`. "Open in playground" is the one entry this app drops — /m has no playground
 * route — and the shared card omits a menu entry whose handler is missing rather than offering a
 * dead one.
 *
 * Same browse shape as sessions and templates: title, create and search sit in a pinned toolbar
 * above the results, so none of them scrolls away with the roster.
 */
export const AgentListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const newAgent = useNewAgentAction(base)
    const query = useAtomValue(agentWorkflowsListQueryStateAtom)
    const [search, setSearch] = useAtom(agentRosterSearchAtom)
    const waitingByAgent = useWaitingByAgent()
    // The shared agent verbs, the same ones the overview header's kebab binds.
    const agentActions = useAgentActions()
    // This list is already resolved client-side, so the term filters it in place — no refetch.
    const agents = useMemo<AgentRosterEntry[]>(
        () =>
            (query.data ?? [])
                .filter((agent) => matchesAgentQuery(agent, search))
                .map((agent) => ({
                    id: agent.id,
                    name: agent.name || agent.slug || "Untitled agent",
                    description: agent.description,
                    updatedAt: agent.updated_at ?? agent.created_at ?? null,
                })),
        [query.data, search],
    )
    const hasQuery = search.trim().length > 0

    // Identical content in both shells — a toolbar above the results, or the rail beside them.
    const browseControls = (
        <div
            className={
                BROWSE_RAIL_MODE
                    ? "contents"
                    : `${pageContentWidthClass} flex shrink-0 flex-col gap-3 px-6 pb-3 pt-2 lg:px-16 lg:pt-14`
            }
        >
            <div className="flex min-w-0 items-center gap-2">
                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                <h1 className="text-colorText m-0 min-w-0 flex-1 truncate text-[24px] font-semibold leading-[1.3333333333333333]">
                    Agents
                </h1>
                <NewAgentAction
                    create={() => void newAgent.create()}
                    createFromTemplate={newAgent.createFromTemplate}
                    base={base}
                    creating={newAgent.creating}
                    error={newAgent.error}
                    align="end"
                />
            </div>

            <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search agents by name…"
            />
        </div>
    )

    const roster = (
        <AgentRosterGrid
            agents={agents}
            isLoading={query.isPending}
            waitingByAgent={waitingByAgent}
            onCreate={() => void newAgent.create()}
            onOpenOverview={(agent) => void router.push(`${base}/agents/${agent.id}`)}
            onRename={(agent) => agentActions.rename({id: agent.id, name: agent.name})}
            onArchive={(agent) => agentActions.remove({id: agent.id, name: agent.name})}
            emptyText={
                hasQuery
                    ? `No agents match "${search.trim()}".`
                    : "Agents you create will show up here."
            }
        />
    )

    return (
        <>
            <PageTitle title="Agents" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                {/* Toolbar by default (#5833/#5846) — beside this app's nav rail a filter rail is
                    the second sidebar those PRs removed. Nothing is lost either way: this surface
                    has no facets, only an identity row and a search box. */}
                <ScreenScaffold fill header={BROWSE_RAIL_MODE ? undefined : browseControls}>
                    {BROWSE_RAIL_MODE ? (
                        <FilterRailLayout
                            rail={browseControls}
                            // pt-4 is breathing room the cards need: the grid's own pt-5 is exactly
                            // the avatar overhang, so without it every avatar sits flush on the
                            // scroll edge.
                            contentClassName="overflow-y-auto px-6 pb-6 pt-4"
                        >
                            {roster}
                        </FilterRailLayout>
                    ) : (
                        <div
                            className={`${pageContentWidthClass} min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 lg:px-16`}
                        >
                            {roster}
                        </div>
                    )}
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
