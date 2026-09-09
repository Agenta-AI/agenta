import {useCallback, useMemo, useState} from "react"

import type {SessionRowVm} from "@agenta/sessions/row"
import {useSessionPins, useSessionsList} from "@agenta/sessions/state"
import {
    SessionListEmpty,
    SessionListError,
    SessionListLoadMore,
    type SessionMenuEntry,
} from "@agenta/sessions-ui"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"

import {SessionRowCells} from "./SessionRowCells"
import {deriveSessionGroups, type SessionGrouping} from "./sessionListView"

/**
 * The four columns, shared by the header row and every body row so the two can never drift.
 *
 * Identity takes twice the share of the two reading columns; the kebab is fixed at the button's
 * own width so the reading columns keep their proportions. The minima plus gaps sum to 436 — the
 * width below which the table scrolls sideways rather than crushing four columns into a phone.
 */
const COLUMNS: ListTableColumn[] = [
    {key: "session", label: "Session", width: "minmax(160px,2fr)"},
    {key: "agent", label: "Agent", width: "minmax(120px,1fr)"},
    {key: "updated", label: "Updated", width: "96px"},
    {key: "actions", label: "Actions", srOnly: true, width: "24px"},
]

const MIN_WIDTH = 440

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
    agentNames,
    verbs,
    onClearFilters,
}: {
    group: SessionGrouping
    /** Agent id → display name, for the group headings. A heading is a string, so it cannot
     *  resolve a name the way a row's `SessionAgentName` does. */
    agentNames: Map<string, string>
    verbs: SessionRowVerbs
    onClearFilters: () => void
}) => {
    const list = useSessionsList({
        // Release contract: the human list hides automation runs; the Type filter's "Automation
        // runs" swaps in the automation policy. Same policies the desktop list passes.
        defaultPolicy: {origin: "exclude-trigger", expansions: []},
        automationPolicy: {origin: "trigger-only", expansions: ["trigger"]},
    })
    const {toggle: togglePin} = useSessionPins()

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
        const out: ListTableGroup<SessionRowVm>[] = []
        for (const source of list.groups) {
            // Pins, and the ungrouped case, keep the headings `useSessionsList` decided —
            // "Pinned 3", "Recent", "Automation runs".
            if (source.key === "pinned" || group === "none") {
                out.push({key: source.key, label: source.label ?? null, rows: source.rows})
                continue
            }
            // Namespaced: a derived key is an agent id or a date bucket, and one of those could
            // otherwise collide with "pinned" and fold two groups into one.
            for (const derived of deriveSessionGroups(source.rows, group, agentNames))
                out.push({...derived, key: `${source.key}:${derived.key}`})
        }
        return out
    }, [agentNames, group, list.groups])

    if (list.isError) return <SessionListError onRetry={list.refetch} />

    return (
        // Say that these rows are a previous query's while a new one resolves. Typing in the
        // search box mints a query per keystroke, so without this the list silently showed
        // results for what you typed a moment ago and looked settled doing it.
        <div aria-busy={list.isPlaceholder || undefined}>
            <div className={list.isPlaceholder ? "opacity-50 transition-opacity" : "transition-opacity"}>
                <ListTable
                    columns={COLUMNS}
                    minWidth={MIN_WIDTH}
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
                        list.isPlaceholder ? null : (
                            <SessionListEmpty
                                filtered={list.filtersActive}
                                onClearFilters={onClearFilters}
                            />
                        )
                    }
                    renderRow={(vm) => (
                        <SessionRowCells
                            vm={vm}
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
