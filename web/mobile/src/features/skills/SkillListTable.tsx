import {useCallback, useState} from "react"
import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableView} from "@agenta/ui/list-table"

import {SkillCardBody} from "./SkillCardBody"
import type {SkillListGroup, SkillListRow} from "./skillListView"
import {SkillRowCells} from "./SkillRowCells"
import {SkillSourceUpdateAction} from "./SkillSourceUpdateAction"

/**
 * The columns, shared by the header row and every body row so the two can never drift.
 *
 * Identity takes twice the share of the reading columns; the kebab is fixed at the button's own
 * width so the reading columns keep their proportions.
 *
 * A phone drops Source rather than scrolling it off: the rows sit under a heading that already
 * names it, and Group by → Source puts it back for a reader who turned grouping off.
 */
const NAME_COLUMN: ListTableColumn = {key: "name", label: "Name", width: "minmax(160px,2fr)"}
const SOURCE_COLUMN: ListTableColumn = {
    key: "source",
    label: "Source",
    width: "minmax(120px,1fr)",
}
const updatedColumn = (width: string): ListTableColumn => ({
    key: "updated",
    label: "Last updated",
    width,
})
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    // Two icon buttons and their gap: the kebab, and the Update mark a check can put beside it.
    // Fixed, so a row with something to update keeps its cells on the others' tracks.
    width: "52px",
}

const WIDE_COLUMNS: ListTableColumn[] = [
    NAME_COLUMN,
    SOURCE_COLUMN,
    updatedColumn("96px"),
    ACTIONS_COLUMN,
]
const NARROW_COLUMNS: ListTableColumn[] = [NAME_COLUMN, updatedColumn("84px"), ACTIONS_COLUMN]

/** Tailwind's `sm`. Below it Source goes; the minima then fit a 375px screen. */
const WIDE_QUERY = "(min-width: 640px)"
const WIDE_MIN_WIDTH = 420
const NARROW_MIN_WIDTH = 320

/** A group's rows all share one repository, so the first says whether it can be checked. */
const repositoryIds = (group: SkillListGroup): string[] =>
    group.rows[0]?.repository ? group.rows.map((row) => row.id) : []

/**
 * The skills registry in the shared frame — rows or cards over the same groups, in the same
 * frame the agents and automations lists use.
 *
 * Every row answers what it is, where it came from and when it last changed, and the whole row
 * opens the drawer because there is nothing else on a row to click. A repository's heading
 * carries the one action that belongs to the group rather than to a skill: checking upstream.
 */
export const SkillListTable = ({
    groups,
    view,
    isLoading,
    onOpen,
    empty,
}: {
    groups: SkillListGroup[]
    view: ListTableView
    isLoading: boolean
    onOpen: (row: SkillListRow) => void
    empty: ReactNode
}) => {
    // Picks the COLUMN SET, not a `display` value: header and body read one array. Asked as
    // "wide?" because the shared hook starts false before it reads the viewport, and a phone
    // is the common case here.
    const narrow = !useMediaQuery(WIDE_QUERY)

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

    const groupActions = useCallback((group: SkillListGroup) => {
        const ids = repositoryIds(group)
        return ids.length ? <SkillSourceUpdateAction ids={ids} /> : null
    }, [])

    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? NARROW_MIN_WIDTH : WIDE_MIN_WIDTH}
            view={view}
            // The column names stay put while the list scrolls, as they do on agents.
            stickyHeader
            loading={isLoading}
            groups={groups}
            rowKey={(row) => row.id}
            onOpenRow={onOpen}
            collapsedKeys={collapsed}
            onToggleGroup={toggleGroup}
            groupActions={groupActions}
            empty={empty}
            renderRow={(row) => <SkillRowCells row={row} narrow={narrow} onOpen={onOpen} />}
            renderCard={(row) => <SkillCardBody row={row} onOpen={onOpen} />}
        />
    )
}
