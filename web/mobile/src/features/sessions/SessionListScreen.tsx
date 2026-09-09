import {useCallback, useEffect, useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {
    applySessionScopeAtom,
    resetSessionFiltersAtom,
    sessionScopeFromRouteQuery,
    sessionSearchAtom,
    useSessionsList,
} from "@agenta/sessions/state"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {SessionAutomationDrawers} from "./SessionAutomationDrawers"
import {SessionFilterMenu} from "./SessionFilterMenu"
import {SessionListTable} from "./SessionListTable"
import {DEFAULT_SESSION_LIST_VIEW, type SessionListView} from "./sessionListView"
import {useSessionRowMenu} from "./useSessionRowMenu"

/**
 * The page column, shared with the automations page: same max width, same gutters, so a reader
 * moving between the two nav entries sees one page frame rather than two.
 */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * The sessions page — the same table, toolbar and filter menu the automations page renders, over
 * the shared session list state.
 *
 * One search field and one filter button, not a row of switches: type, status, agent and how the
 * rows are cut all live inside the menu, so this app has ONE way to configure a list rather than
 * one per page. Filtering still runs on the shared atoms `@agenta/sessions/state` owns, so this
 * page and the desktop one narrow the same set the same way; only the controls differ.
 */
export const SessionListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    // `?mode=automation` — what the agent overview's "Automation runs" card links to, so a cold
    // load or a pasted link lands on the same set the card was showing.
    const router = useRouter()
    const applyScope = useSetAtom(applySessionScopeAtom)
    const routeMode = typeof router.query.mode === "string" ? router.query.mode : undefined
    useEffect(() => {
        const scope = sessionScopeFromRouteQuery({mode: routeMode})
        if (scope) applyScope(scope)
    }, [applyScope, routeMode])

    const list = useSessionsList({
        defaultPolicy: {origin: "exclude-trigger", expansions: []},
        automationPolicy: {origin: "trigger-only", expansions: ["trigger"]},
    })

    // Grouping is a display preference a reader sets once; the filters are a question they were
    // asking at the time, so only the first survives a reload — and the filters live in the
    // shared atoms anyway.
    const [view, setView] = useFilterMenuView<SessionListView>({
        key: "agenta:sessions:view",
        fallback: DEFAULT_SESSION_LIST_VIEW,
        persist: ["group"],
    })

    // Debounced: the search is a server predicate on two queries, so every keystroke would
    // otherwise refetch both. Seeded from the atom, which outlives this mount — coming back to a
    // narrowed list with an empty box reads as broken rather than as filtered.
    const setSearch = useSetAtom(sessionSearchAtom)
    const seedSearch = useAtomValue(sessionSearchAtom)
    const search = useDebouncedAtomSearch(setSearch, 300, seedSearch)

    const resetFilters = useSetAtom(resetSessionFiltersAtom)
    // Two resets, because they undo different things. Clearing filters is what the empty state
    // offers when a query hid every row; the menu's reset also puts the grouping back. Both have
    // to clear the search DRAFT as well as the atom, or the field keeps a term that no longer
    // applies to the rows under it.
    const clearFilters = useCallback(() => {
        resetFilters()
        search.reset()
    }, [resetFilters, search])
    const resetView = useCallback(() => {
        clearFilters()
        setView(DEFAULT_SESSION_LIST_VIEW)
    }, [clearFilters, setView])

    // The shared row verbs — rename, pin, archive, delete — the same ones the agent overview and
    // the desktop list bind. Without them a row here offers only the pin.
    const sessionMenu = useSessionRowMenu(`/w/${workspaceId}/p/${projectId}`)
    const verbs = useMemo(
        () => ({
            open: sessionMenu.open,
            menuFor: sessionMenu.menuFor,
            onMenuSelect: sessionMenu.onMenuSelect,
            onRenameRow: sessionMenu.onRenameRow,
        }),
        [sessionMenu.menuFor, sessionMenu.onMenuSelect, sessionMenu.onRenameRow, sessionMenu.open],
    )

    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    // The menu's Agent row offers this roster; the group headings label from it.
    const agents = useMemo(
        () =>
            (agentsQuery.data ?? [])
                .map((agent: Workflow) => ({
                    id: agent.id,
                    name: (agent.name || agent.slug || "").trim(),
                }))
                .filter((agent: {id: string; name: string}) => agent.id && agent.name),
        [agentsQuery.data],
    )
    const agentNames = useMemo(
        () => new Map(agents.map((agent: {id: string; name: string}) => [agent.id, agent.name])),
        [agents],
    )

    return (
        <>
            <PageTitle title="Sessions" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        // The same frame the automations header uses, so the two pages line up at
                        // every width: page column, 16px gutters on a phone, 64px and a deeper
                        // top from `lg`.
                        <div className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}>
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Sessions
                                </h1>
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        {/* Search belongs to the list, not to the page: it sits on the table's own
                            left edge so it reads as the control that narrows what is below it.
                            One control beside the field, not four — type, status, agent and
                            grouping are rows inside it, so the bar stays a search bar. */}
                        <ListTableToolbar
                            search={search.value}
                            onSearchChange={search.onChange}
                            searchPlaceholder="Search sessions"
                            actions={
                                <SessionFilterMenu
                                    view={view}
                                    onChange={setView}
                                    agents={agents}
                                    waitingCount={list.waitingCount}
                                    onReset={resetView}
                                />
                            }
                        />
                        <SessionListTable
                            group={view.group}
                            agentNames={agentNames}
                            verbs={verbs}
                            onClearFilters={clearFilters}
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
            {/* The trigger drawers the automation row verbs open, at screen level so one survives
                its row unmounting underneath it. */}
            <SessionAutomationDrawers base={`/w/${workspaceId}/p/${projectId}`} />
        </>
    )
}
