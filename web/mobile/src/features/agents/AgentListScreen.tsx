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
import {ListTableViewToggle} from "@agenta/ui/list-table"
import {Button, PageToolbar} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import {useAtom, useAtomValue} from "jotai"

import {openAgentFromList} from "../agent-pages/openAgentFromList"
import {startBlankSession} from "../chat/useStartBlankSession"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {FeatureOnboarding} from "../education/FeatureOnboarding"
import {HowThisWorksButton} from "../education/HowThisWorksButton"
import {PageLayout} from "../page-layout/PageLayout"

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
            // Only the archive is chosen: nothing is archived, not a filter that hid it.
            archiveEmpty={
                !term &&
                view.type === "archived" &&
                isDefaultAgentFilters({...view, type: DEFAULT_AGENT_LIST_VIEW.type})
            }
            onShowActive={() => setView({...view, type: DEFAULT_AGENT_LIST_VIEW.type})}
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
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                title={t("agents.list.pageTitle")}
                description={t("agents.list.pageDescription")}
                toolbar={
                    projectEmpty ? undefined : (
                        <PageToolbar
                            search={search}
                            onSearchChange={setSearch}
                            searchPlaceholder={t("agents.list.searchPlaceholder")}
                            actions={
                                <AgentFilterMenu view={view} onChange={setView} owners={owners} />
                            }
                            end={<ListTableViewToggle value={view.mode} onChange={setMode} />}
                        />
                    )
                }
                actions={
                    <>
                        {projectEmpty ? null : (
                            <HowThisWorksButton guide="agents" className="max-sm:hidden" />
                        )}
                        <NewAgentAction newAgent={newAgent} base={base} align="end" />
                    </>
                }
            >
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
                    body
                )}
            </PageLayout>
        </>
    )
}
