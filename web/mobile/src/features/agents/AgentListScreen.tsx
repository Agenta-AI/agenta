import {useCallback, useMemo} from "react"

import {
    agentRosterSearchAtom,
    agentWorkflowsListQueryStateAtom,
    matchesAgentQuery,
} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import agentsList from "@agenta/i18n/catalogs/agents.list"
import {useWaitingByAgent} from "@agenta/sessions/state"
import {userAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {ListTableToolbar, ListTableViewToggle} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {openAgentFromList} from "../agent-pages/openAgentFromList"
import {startBlankSession} from "../chat/useStartBlankSession"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {FeatureOnboarding} from "../education/FeatureOnboarding"
import {HowThisWorksButton} from "../education/HowThisWorksButton"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AgentFilterMenu} from "./AgentFilterMenu"
import {AgentListTable} from "./AgentListTable"
import {
    DEFAULT_AGENT_LIST_VIEW,
    deriveAgentList,
    isDefaultAgentFilters,
    toAgentListRow,
    type AgentListRow,
    type AgentListView,
} from "./agentListView"
import {NewAgentAction} from "./NewAgentAction"
import {AgentsNoMatch} from "./states/AgentsNoMatch"
import {useAgentOwners} from "./useAgentOwners"
import {useAgentRowActions} from "./useAgentRowActions"
import {useArchivedAgents} from "./useArchivedAgents"
import {useNewAgentAction} from "./useNewAgentAction"

/** The page column: centered, 960 px wide with 24 px gutters on a desktop (A03). */
const PAGE_FRAME = "mx-auto box-border w-full max-w-[960px] px-4 md:px-6"

/**
 * The full agent roster — where the nav's Agents entry lands.
 *
 * The roster is the shared `ListTable` — the frame the sessions and automations lists use — with
 * this app's columns and the shared agent kebab, so a row and an agent's own header offer the
 * same verbs. It offers the frame's card view too, switched from the toolbar as on skills.
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
    const t = useT(agentsList)
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const newAgent = useNewAgentAction(base)
    const rowActions = useAgentRowActions(base, projectId)
    const query = useAtomValue(agentWorkflowsListQueryStateAtom)
    const [search, setSearch] = useAtom(agentRosterSearchAtom)
    const waitingByAgent = useWaitingByAgent()
    const queryClient = useQueryClient()

    // Grouping and the view mode are how a reader chose to read the list; the filters are a
    // question they were asking at the time, so only the first two survive a reload.
    const [view, setView] = useFilterMenuView<AgentListView>({
        key: "agenta:agents:view",
        fallback: DEFAULT_AGENT_LIST_VIEW,
        persist: ["group", "mode"],
    })

    const showArchived = view.type === "archived"
    // Nothing is active and nothing is searched: the project may still hold archived agents, and
    // the first-run page has no filter bar to reach them with, so they are looked up here too.
    const noActiveAgents = !query.isPending && !query.isError && (query.data ?? []).length === 0
    const archived = useArchivedAgents({
        projectId,
        enabled: showArchived || (noActiveAgents && !search.trim()),
    })
    // The project's member roster: the Owner column and the facet both name owners, and neither
    // can from an id alone. An id outside it is a former member.
    const {owners, ownerNames} = useAgentOwners()
    const me = useAtomValue(userAtom)

    // This list is already resolved client-side, so the term filters it in place — no refetch.
    // Matched on the WORKFLOW, not on the row: the shared rule reads the slug too, and the row
    // has already resolved a name over it.
    const rows = useMemo<AgentListRow[]>(() => {
        // One roster at a time: Archived shows what was put away INSTEAD of what is in use.
        const source = showArchived ? archived.agents : (query.data ?? [])
        return source
            .filter((workflow) => matchesAgentQuery(workflow, search))
            .map((workflow) =>
                toAgentListRow(workflow, {
                    currentUserId: me?.id,
                    ownerNames,
                    waiting: waitingByAgent.get(workflow.id) ?? 0,
                }),
            )
    }, [archived.agents, me?.id, ownerNames, query.data, search, showArchived, t, waitingByAgent])

    const groups = useMemo(() => deriveAgentList(rows, view), [rows, view, t])
    const term = search.trim()
    // The archived fetch must not blank rows already on screen: a skeleton over a list that was
    // showing nine agents reads as "they went away". It only owns the skeleton when there is
    // nothing else to draw — which is exactly the "Only archived" case.
    const isLoading = query.isPending || (archived.isPending && rows.length === 0)
    // "This project has no agents" is a claim about the project, so it is only ever made about
    // the unnarrowed list — a search that matches nothing empties this one too.
    const projectHasAgents = (query.data ?? []).length > 0
    const openRow = useCallback(
        (row: AgentListRow) => {
            // An archived agent has no agent sidebar (the sidebar shows only listed agents): it
            // opens a new session, as before.
            if (row.archived) startBlankSession(base, row.id)
            else void openAgentFromList({queryClient, base, projectId, agentId: row.id})
        },
        [base, projectId, queryClient],
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
        // The grouping and the mode survive: they are how the reader chose to read the list,
        // not what they narrowed it to.
        () => setView({...DEFAULT_AGENT_LIST_VIEW, group: view.group, mode: view.mode}),
        [setView, view.group, view.mode],
    )
    const setMode = useCallback(
        (mode: AgentListView["mode"]) => setView({...view, mode}),
        [setView, view],
    )

    // No agent in use and no search: teach agents instead of listing them.
    const projectEmpty =
        !query.isPending && !query.isError && !projectHasAgents && !term && !showArchived
    const emptyState = isLoading ? null : (
        <AgentsNoMatch
            term={term || undefined}
            onClear={
                term ? () => setSearch("") : isDefaultAgentFilters(view) ? undefined : resetFilters
            }
        />
    )

    const body = failed ? (
        // A failed fetch must not read as an empty project, so the error replaces the results
        // rather than sitting under a header row that is no longer describing anything.
        <LoadError framed title={t("agents.list.loadError")} onRetry={retry} />
    ) : (
        <AgentListTable
            groups={groups}
            view={view.mode}
            isLoading={isLoading}
            onOpen={openRow}
            actions={rowActions}
            empty={emptyState}
        />
    )

    return (
        <>
            <PageTitle title={t("agents.list.pageTitle")} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className={`shrink-0 pb-3 pt-3 md:pt-10 ${PAGE_FRAME}`}>
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                {/* From `sm`, 24px is the desktop page-title rung; on a phone it
                                    eats the row, so the title drops to the 16px body ramp. */}
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-8">
                                    {t("agents.list.pageTitle")}
                                </h1>
                                {projectEmpty ? null : (
                                    <HowThisWorksButton guide="agents" className="max-sm:hidden" />
                                )}
                                <NewAgentAction
                                    newAgent={newAgent}
                                    base={base}
                                    align="end"
                                    // The canvas size (A03): 28 px high, radius 6, 13 px.
                                    className="h-control-sm rounded-[6px] px-btn-sm text-btn-sm"
                                />
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 pb-12 pt-3 md:pt-0 ${PAGE_FRAME}`}>
                        {projectEmpty ? (
                            <>
                                <FeatureOnboarding guideKey="agents" base={base} />
                                {archived.agents.length > 0 ? (
                                    <div className="mt-6 flex justify-center">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => setView({...view, type: "archived"})}
                                        >
                                            {t("agents.list.viewArchived")}
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        ) : (
                            <>
                                {/* Search belongs to the list, not to the page: it sits on the
                                    results' own left edge so it reads as the control that narrows
                                    what is below it. The facets and the grouping ride one control
                                    beside it, so the bar stays a search bar; the view switch takes
                                    the far edge, where it changes how the results are drawn rather
                                    than which ones are. */}
                                <ListTableToolbar
                                    // A 300 x 30 field with a light border, 10 px above the
                                    // table (A03).
                                    className="mb-2.5 md:[&_[data-slot=input-group]]:h-[30px] md:[&_[data-slot=input-group]]:max-w-[300px] md:[&_[data-slot=input-group]]:rounded-md md:[&_[data-slot=input-group]]:border-colorBorderSecondary"
                                    search={search}
                                    onSearchChange={setSearch}
                                    searchPlaceholder={t("agents.list.searchPlaceholder")}
                                    actions={
                                        <>
                                            <AgentFilterMenu
                                                view={view}
                                                onChange={setView}
                                                owners={owners}
                                            />
                                            <ListTableViewToggle
                                                value={view.mode}
                                                onChange={setMode}
                                                className="ml-auto"
                                            />
                                        </>
                                    }
                                />
                                {body}
                            </>
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
