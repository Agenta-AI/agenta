import {useCallback, useMemo, useState} from "react"

import type {SessionRowVm} from "@agenta/sessions/row"
import {
    rowsFromPages,
    useSessionFilters,
    useSessionList,
    useSessionsList,
} from "@agenta/sessions/state"
import {SessionListLoadMore} from "@agenta/sessions-ui"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"

import type {SessionRowVerbs} from "../sessions/SessionListTable"
import {deriveSessionGroups} from "../sessions/sessionListView"
import {SessionsError} from "../sessions/states/SessionsError"
import {SessionsNoMatch} from "../sessions/states/SessionsNoMatch"

import {AgentActivityRowCells} from "./AgentActivityRowCells"
import {
    agentActivityPolicy,
    type AgentActivityTab,
    type AgentActivityView,
} from "./agentActivityView"
import {AgentActivityEmpty} from "./states/AgentActivityEmpty"

/** The sessions page's phone columns: the title takes the row, the time sits against the kebab. */
const columnsFor = (tab: AgentActivityTab): ListTableColumn[] => [
    {key: "title", label: tab === "runs" ? "Run" : "Session", width: "minmax(160px,1fr)"},
    {key: "updated", label: "Updated", width: "64px", headerClassName: "text-right"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]
const MIN_WIDTH = 272

/**
 * One agent's activity, in the frame the sessions page uses: the tab pins the origin, the menu
 * cuts and narrows the rest. Pins stay their own group at the top whatever the grouping is.
 */
export const AgentActivityTable = ({
    agentId,
    view,
    activityFloor,
    verbs,
    onClearSearch,
    onResetView,
}: {
    agentId: string
    view: AgentActivityView
    /** ISO floor from the Last activity facet; undefined = no bound. */
    activityFloor?: string
    verbs: SessionRowVerbs
    onClearSearch: () => void
    onResetView: () => void
}) => {
    const policy = useMemo(() => agentActivityPolicy(view.tab), [view.tab])
    const columns = useMemo(() => columnsFor(view.tab), [view.tab])
    const list = useSessionsList({
        agentId,
        activityFloor,
        defaultPolicy: policy,
        automationPolicy: policy,
    })
    // The APPLIED term, so the empty state can never name a search that has not run yet.
    const term = useSessionFilters().search.trim()

    const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
    const toggleGroup = useCallback(
        (key: string) =>
            setCollapsed((current) => {
                const next = new Set(current)
                if (!next.delete(key)) next.add(key)
                return next
            }),
        [],
    )

    const groups = useMemo<ListTableGroup<SessionRowVm>[]>(() => {
        const out: ListTableGroup<SessionRowVm>[] = []
        for (const source of list.groups) {
            if (source.key === "pinned") {
                out.push({key: source.key, label: source.label ?? null, rows: source.rows})
                continue
            }
            // Flat under "none": the tab already names what the rows are.
            if (view.group === "none") {
                if (source.rows.length) out.push({key: source.key, label: null, rows: source.rows})
                continue
            }
            for (const derived of deriveSessionGroups(source.rows, view.group))
                out.push({...derived, key: `${source.key}:${derived.key}`})
        }
        return out
    }, [list.groups, view.group])

    // Does this agent have ANY session of this kind? The page cannot tell "none yet" from
    // "the filters hid them" out of what it holds, so it asks — the sessions page's own probe,
    // scoped to the agent. Runs only while the list is empty.
    const probe = useSessionList({
        agentId,
        originPolicy: policy.origin,
        expansions: [],
        includeArchived: true,
        limit: 1,
        enabled: list.isEmpty && !list.isPlaceholder && !list.isPending,
    })
    const agentHasRows = rowsFromPages(probe.data?.pages).length > 0

    if (list.isError) return <SessionsError onRetry={list.refetch} />

    return (
        <div aria-busy={list.isPlaceholder || undefined}>
            <div
                className={
                    list.isPlaceholder ? "opacity-50 transition-opacity" : "transition-opacity"
                }
            >
                <ListTable
                    columns={columns}
                    minWidth={MIN_WIDTH}
                    stickyHeader
                    // The tab above already names the rows; a header row said it twice.
                    hideHeader
                    density="compact"
                    loading={list.isPending}
                    groups={groups}
                    rowKey={(vm) => vm.id}
                    onOpenRow={verbs.open}
                    collapsedKeys={collapsed}
                    onToggleGroup={toggleGroup}
                    empty={
                        // Nothing while unsettled: the rows may be a previous query's, or the
                        // probe may not have said yet. A guess here tells a reader with sessions
                        // that they have none.
                        list.isPlaceholder || probe.isPending ? null : agentHasRows ? (
                            <SessionsNoMatch
                                term={term || undefined}
                                onClear={term ? onClearSearch : onResetView}
                            />
                        ) : (
                            <AgentActivityEmpty tab={view.tab} />
                        )
                    }
                    renderRow={(vm) => (
                        <AgentActivityRowCells
                            vm={vm}
                            entries={verbs.menuFor(vm)}
                            onMenuSelect={verbs.onMenuSelect}
                            onRenameRow={verbs.onRenameRow}
                        />
                    )}
                />
                {list.paging.hasNext ? (
                    <SessionListLoadMore
                        loading={list.paging.isLoadingNext}
                        onClick={list.paging.loadNext}
                    />
                ) : null}
            </div>
        </div>
    )
}
