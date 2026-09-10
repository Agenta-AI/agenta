import {useCallback, useMemo, useState} from "react"

import type {SessionRowVm} from "@agenta/sessions/row"
import {
    rowsFromPages,
    sessionSearchAtom,
    useSessionList,
    useSessionPins,
    useSessionsList,
} from "@agenta/sessions/state"
import {SessionListLoadMore, type SessionMenuEntry} from "@agenta/sessions-ui"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"
import {useAtomValue} from "jotai"

import {useMediaQuery} from "@/lib/useMediaQuery"

import {deriveSessionGroups, type SessionGrouping} from "./sessionListView"
import {SessionRowCells} from "./SessionRowCells"
import {SessionsEmpty} from "./states/SessionsEmpty"
import {SessionsError} from "./states/SessionsError"
import {SessionsNoMatch} from "./states/SessionsNoMatch"

/**
 * The columns, shared by the header row and every body row so the two can never drift.
 *
 * Identity takes twice the share of the reading columns; the kebab is fixed at the button's own
 * width so the reading columns keep their proportions.
 *
 * A phone drops the Agent column outright rather than scrolling it off. Four columns in 375px
 * left the title a dozen characters and pushed Updated past the edge, and a session's own name is
 * what a reader is looking for — the agent is already the default grouping, so on a narrow screen
 * the heading above the run says it once instead of every row repeating it.
 */
const SESSION_COLUMN: ListTableColumn = {
    key: "session",
    label: "Session",
    width: "minmax(160px,2fr)",
}
/**
 * Right-aligned, so the timestamp sits against the kebab at the row's end rather than floating in
 * the middle of its track — and the header follows its cells.
 *
 * Narrower on a phone. "13d ago" is the longest thing this column ever holds and it measures ~52px,
 * so 96 was 40px of air taken straight off the title, which is the one column that needed it.
 */
const updatedColumn = (width: string): ListTableColumn => ({
    key: "updated",
    label: "Updated",
    width,
    headerClassName: "text-right",
})
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
}
// Status earns a column where there is room for the word. On a phone it stays the dot beside the
// title: a column there would cost the title the width it needs to be a title.
const WIDE_COLUMNS: ListTableColumn[] = [
    SESSION_COLUMN,
    {key: "status", label: "Status", width: "minmax(110px,1fr)"},
    {key: "agent", label: "Agent", width: "minmax(120px,1fr)"},
    updatedColumn("96px"),
    ACTIONS_COLUMN,
]
const NARROW_COLUMNS: ListTableColumn[] = [SESSION_COLUMN, updatedColumn("64px"), ACTIONS_COLUMN]

/** Tailwind's `sm`. Below it the Agent column goes; the minima then fit a 375px screen. */
const NARROW_QUERY = "(max-width: 639.98px)"
const WIDE_MIN_WIDTH = 560
const NARROW_MIN_WIDTH = 272

/** What the screen's `useSessionRowMenu` supplies — bound here, resolved there. */
export interface SessionRowVerbs {
    open: (vm: SessionRowVm) => void
    menuFor: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect: (vm: SessionRowVm, key: string) => void
    onRenameRow: (vm: SessionRowVm, name: string) => Promise<boolean>
}

/**
 * The sessions list itself: the shared list state, cut into groups, in the frame the automations
 * table uses.
 *
 * Pins stay their own group at the top whatever the grouping is — a pin is an explicit request,
 * not a property to sort by — and only the rest is re-cut. `useSessionsList` already excludes
 * pinned rows from the main query, so nothing appears twice.
 */
export const SessionListTable = ({
    group,
    activityFloor,
    agentNames,
    agentNamesReady,
    verbs,
    onClearSearch,
    onResetView,
}: {
    group: SessionGrouping
    /** ISO floor from the Last activity facet; undefined = no bound. */
    activityFloor?: string
    /** Agent id → display name, for the group headings. A heading is a string, so it cannot
     *  resolve a name the way a row's `SessionAgentName` does. */
    agentNames: Map<string, string>
    /**
     * Whether that roster has arrived. Until it has, grouping by agent would label every run
     * "Unknown agent" — a confident claim about rows whose agent this client simply has not read
     * yet — so the list stays in one unlabelled run until it can name them.
     */
    agentNamesReady: boolean
    verbs: SessionRowVerbs
    /** Undoes the SEARCH only — what a term that matched nothing needs. */
    onClearSearch: () => void
    /** Undoes every facet, the grouping and the search. */
    onResetView: () => void
}) => {
    const list = useSessionsList({
        activityFloor,
        // Release contract: the human list hides automation runs; the Type filter's "Automation
        // runs" swaps in the automation policy. Same policies the desktop list passes.
        defaultPolicy: {origin: "exclude-trigger", expansions: []},
        automationPolicy: {origin: "trigger-only", expansions: ["trigger"]},
    })
    const {toggle: togglePin} = useSessionPins()
    // Picks the COLUMN SET, not a `display` value: header and body read one array. Narrow is the
    // server default because a phone is the common case and the wide-first paint was visible.
    const narrow = useMediaQuery(NARROW_QUERY, true)
    // The APPLIED term, not the field's draft: the empty state quotes what the rows were actually
    // queried for, so it can never name a search that has not run yet.
    const term = useAtomValue(sessionSearchAtom).trim()

    // Does the project have ANY session? The empty state cannot tell "none yet" from "filters
    // hid them" out of what the page holds, so it asks. Runs only while the list is empty.
    const probe = useSessionList({
        originPolicy: "all",
        expansions: [],
        includeArchived: true,
        limit: 1,
        enabled: list.isEmpty && !list.isPlaceholder && !list.isPending,
    })
    const projectHasSessions = rowsFromPages(probe.data?.pages).length > 0

    // Group headings carry a chevron, so it has to do something: collapsed keys, not a flag per
    // group, because the groups themselves come and go as the grouping changes.
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
        const cut = group === "agent" && !agentNamesReady ? "none" : group
        const out: ListTableGroup<SessionRowVm>[] = []
        for (const source of list.groups) {
            // Pins, and the ungrouped case, keep the headings `useSessionsList` decided —
            // "Pinned 3", "Recent", "Automation runs".
            if (source.key === "pinned" || cut === "none") {
                out.push({key: source.key, label: source.label ?? null, rows: source.rows})
                continue
            }
            // Namespaced: a derived key is an agent id or a date bucket, and one of those could
            // otherwise collide with "pinned" and fold two groups into one.
            for (const derived of deriveSessionGroups(source.rows, cut, agentNames))
                out.push({...derived, key: `${source.key}:${derived.key}`})
        }
        return out
    }, [agentNames, agentNamesReady, group, list.groups])

    if (list.isError) return <SessionsError onRetry={list.refetch} />

    return (
        // Say that these rows are a previous query's while a new one resolves. Typing in the
        // search box mints a query per keystroke, so without this the list silently showed
        // results for what you typed a moment ago and looked settled doing it.
        <div aria-busy={list.isPlaceholder || undefined}>
            <div
                className={
                    list.isPlaceholder ? "opacity-50 transition-opacity" : "transition-opacity"
                }
            >
                <ListTable
                    columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
                    minWidth={narrow ? NARROW_MIN_WIDTH : WIDE_MIN_WIDTH}
                    // Sessions is the long list in this app — hundreds of rows, four screens of
                    // scrolling — so the column names have to stay put. Affordable here because
                    // the minima fit every width this page is read at, so the frame's own
                    // horizontal scroller was never doing anything.
                    stickyHeader
                    loading={list.isPending}
                    groups={groups}
                    rowKey={(vm) => vm.id}
                    onOpenRow={verbs.open}
                    collapsedKeys={collapsed}
                    onToggleGroup={toggleGroup}
                    empty={
                        // Never while the rows are a previous query's. "No sessions yet" is a
                        // claim about the account, and showing it over an unsettled query told
                        // people with 43 sessions they had none.
                        //
                        // And never when a filter is what emptied the list: the two states make
                        // different claims, and only one of them has a way out.
                        // Nothing at all while the answer is still unsettled: the rows may be a
                        // previous query's, or the probe may not have said yet whether this
                        // project has sessions. Either way both states would be a guess, and one
                        // of them tells a reader with 43 sessions that they have none.
                        list.isPlaceholder || probe.isPending ? null : projectHasSessions ? (
                            // The project has sessions and this list has none, so something on
                            // this page narrowed them away — no need to work out which control.
                            <SessionsNoMatch
                                term={term || undefined}
                                onClear={term ? onClearSearch : onResetView}
                            />
                        ) : (
                            <SessionsEmpty />
                        )
                    }
                    renderRow={(vm) => (
                        <SessionRowCells
                            vm={vm}
                            narrow={narrow}
                            entries={verbs.menuFor(vm)}
                            onMenuSelect={verbs.onMenuSelect}
                            onRenameRow={verbs.onRenameRow}
                            onTogglePin={togglePin}
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
