import {useCallback, useMemo} from "react"

import {
    agentRosterSearchAtom,
    agentWorkflowsListQueryStateAtom,
    matchesAgentQuery,
    type Workflow,
} from "@agenta/entities/workflow"
import {useWaitingByAgent} from "@agenta/sessions/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AgentFilterMenu} from "./AgentFilterMenu"
import {AgentListTable} from "./AgentListTable"
import {
    DEFAULT_AGENT_LIST_VIEW,
    deriveAgentList,
    isDefaultAgentFilters,
    type AgentListRow,
    type AgentListView,
} from "./agentListView"
import {NewAgentAction} from "./NewAgentAction"
import {AgentsEmpty} from "./states/AgentsEmpty"
import {AgentsError} from "./states/AgentsError"
import {AgentsNoMatch} from "./states/AgentsNoMatch"
import {useAgentOwners} from "./useAgentOwners"
import {useArchivedAgents} from "./useArchivedAgents"
import {useNewAgentAction} from "./useNewAgentAction"

/** The page column, shared with sessions and automations, so the nav entries line up. */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/** The one place a workflow becomes a row: both views read what this resolves, never the raw
 *  workflow and never the lookup maps behind it. */
const toRow = (workflow: Workflow, ownerName: string, waiting: number): AgentListRow => ({
    id: workflow.id,
    name: workflow.name || workflow.slug || "Untitled agent",
    description: workflow.description ?? null,
    updatedAt: workflow.updated_at ?? workflow.created_at ?? null,
    ownerName,
    createdById: workflow.created_by_id ?? null,
    waiting,
})

/**
 * The full agent roster — where the nav's Agents entry lands.
 *
 * The roster is the shared `ListTable` — the frame the sessions and automations lists use — with
 * this app's columns and the shared agent kebab, so a row and an agent's own header offer the
 * same verbs.
 *
 * Search and the filter menu sit in one toolbar above the results, the same row the automations
 * list opens with.
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
    const queryClient = useQueryClient()

    // Grouping is a display preference a reader sets once; the filters are a question they were
    // asking at the time, so only the first survives a reload.
    const [view, setView] = useFilterMenuView<AgentListView>({
        key: "agenta:agents:view",
        fallback: DEFAULT_AGENT_LIST_VIEW,
        persist: ["group"],
    })

    const showArchived = view.type === "archived"
    const archived = useArchivedAgents({projectId, enabled: showArchived})
    // One cached request, shared with the settings screen: the Created by column and the facet
    // both name creators, and neither can from an id alone.
    const {owners, ownerNames} = useAgentOwners({workspaceId, projectId})

    // This list is already resolved client-side, so the term filters it in place — no refetch.
    // Matched on the WORKFLOW, not on the row: the shared rule reads the slug too, and the row
    // has already resolved a name over it.
    const rows = useMemo<AgentListRow[]>(() => {
        // One roster at a time: Archived shows what was put away INSTEAD of what is in use.
        const source = showArchived ? archived.agents : (query.data ?? [])
        return source
            .filter((workflow) => matchesAgentQuery(workflow, search))
            .map((workflow) =>
                toRow(
                    workflow,
                    ownerNames.get(workflow.created_by_id ?? "")?.trim() ?? "",
                    waitingByAgent.get(workflow.id) ?? 0,
                ),
            )
    }, [archived.agents, ownerNames, query.data, search, showArchived, waitingByAgent])

    const groups = useMemo(() => deriveAgentList(rows, view), [rows, view])
    const term = search.trim()
    // The archived fetch must not blank rows already on screen: a skeleton over a list that was
    // showing nine agents reads as "they went away". It only owns the skeleton when there is
    // nothing else to draw — which is exactly the "Only archived" case.
    const isLoading = query.isPending || (archived.isPending && rows.length === 0)
    // "This project has no agents" is a claim about the project, so it is only ever made about
    // the unnarrowed list — a search that matches nothing empties this one too.
    const projectHasAgents = (query.data ?? []).length > 0
    const openRow = useCallback(
        (row: AgentListRow) => void router.push(`${base}/agents/${row.id}`),
        [base, router],
    )
    const failed = showArchived ? archived.isError : query.isError
    const refetchArchived = archived.refetch
    const retry = useCallback(() => {
        if (showArchived) void refetchArchived()
        // The live roster is a query atom with no refetch handle of its own; the key it is
        // cached under is the one `useAgentActions` invalidates after a write.
        else void queryClient.invalidateQueries({queryKey: ["workflows"]})
    }, [queryClient, refetchArchived, showArchived])
    const resetFilters = useCallback(
        // The grouping survives: it is how the reader chose to read the list, not what they
        // narrowed it to.
        () => setView({...DEFAULT_AGENT_LIST_VIEW, group: view.group}),
        [setView, view.group],
    )

    const emptyState = isLoading ? null : projectHasAgents ? (
        <AgentsNoMatch
            term={term || undefined}
            onClear={
                term ? () => setSearch("") : isDefaultAgentFilters(view) ? undefined : resetFilters
            }
        />
    ) : (
        <AgentsEmpty />
    )

    const body = failed ? (
        // A failed fetch must not read as an empty project, so the error replaces the results
        // rather than sitting under a header row that is no longer describing anything.
        <AgentsError onRetry={retry} />
    ) : (
        <AgentListTable groups={groups} isLoading={isLoading} onOpen={openRow} empty={emptyState} />
    )

    return (
        <>
            <PageTitle title="Agents" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                {/* From `sm`, 24px is the desktop page-title rung; on a phone it
                                    eats the row, so the title drops to the 16px body ramp. */}
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Agents
                                </h1>
                                <NewAgentAction
                                    create={() => void newAgent.create()}
                                    createFromTemplate={newAgent.createFromTemplate}
                                    base={base}
                                    creating={newAgent.creating}
                                    error={newAgent.error}
                                    align="end"
                                    className="h-control-sm rounded-control-sm px-btn-sm text-btn-sm sm:h-control sm:rounded-control sm:px-btn sm:text-btn-md"
                                />
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        {/* Search belongs to the list, not to the page: it sits on the results'
                            own left edge so it reads as the control that narrows what is below
                            it. One control beside it, not three: the facets and the grouping are
                            rows inside it, so the bar stays a search bar. */}
                        <ListTableToolbar
                            search={search}
                            onSearchChange={setSearch}
                            searchPlaceholder="Search agents by name…"
                            actions={
                                <AgentFilterMenu view={view} onChange={setView} owners={owners} />
                            }
                        />
                        {body}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
