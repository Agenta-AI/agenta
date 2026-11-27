import {useCallback} from "react"
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {useMediaQuery} from "@agenta/ui/hooks"
import {
    LIST_CARD_MIN_WIDTH,
    LIST_COLUMN_WIDTH,
    ListTable,
    type ListTableColumn,
    type ListTableView,
} from "@agenta/ui/list-table"

import {SkillCardBody} from "./SkillCardBody"
import type {SkillGrouping, SkillListGroup, SkillListRow} from "./skillListView"
import {SkillRowCells} from "./SkillRowCells"
import {SkillSourceUpdateAction} from "./SkillSourceUpdateAction"

type ListText = ReturnType<typeof useT<[typeof skillsListCatalog]>>

const nameColumn = (t: ListText): ListTableColumn => ({
    key: "name",
    label: t("skills.list.columnName"),
    width: LIST_COLUMN_WIDTH.primary,
})
/** Grouped by source, the heading already names it, so the column names the author instead. */
const provenanceColumn = (t: ListText, group: SkillGrouping): ListTableColumn => ({
    key: "provenance",
    label: group === "source" ? t("skills.list.columnCreatedBy") : t("skills.list.columnSource"),
    width: LIST_COLUMN_WIDTH.secondary,
})
const usedByColumn = (t: ListText): ListTableColumn => ({
    key: "usedBy",
    label: t("skills.list.columnUsedBy"),
    width: LIST_COLUMN_WIDTH.name,
})
const updatedColumn = (t: ListText, width: string): ListTableColumn => ({
    key: "updated",
    label: t("skills.list.columnLastUpdated"),
    width,
})
/** Wide: the kebab and the Update mark beside it. Narrow: the kebab alone. */
const actionsColumn = (t: ListText, width: string): ListTableColumn => ({
    key: "actions",
    label: t("skills.list.columnActions"),
    srOnly: true,
    width,
})

const wideColumns = (t: ListText, group: SkillGrouping): ListTableColumn[] => [
    nameColumn(t),
    usedByColumn(t),
    provenanceColumn(t, group),
    updatedColumn(t, LIST_COLUMN_WIDTH.time),
    actionsColumn(t, LIST_COLUMN_WIDTH.actionsWide),
]
// A phone row is the Mark, the name, the time and the kebab.
const narrowColumns = (t: ListText): ListTableColumn[] => [
    nameColumn(t),
    updatedColumn(t, LIST_COLUMN_WIDTH.timeCompact),
    actionsColumn(t, LIST_COLUMN_WIDTH.actions),
]

/** Tailwind's `sm`. Below it Source and Used by go; the minima then fit a 375px screen. */
const WIDE_QUERY = "(min-width: 640px)"
const WIDE_MIN_WIDTH = 680
const NARROW_MIN_WIDTH = 320

/** A group's rows all share one repository, so the first says whether it can be checked. */
const repositoryIds = (group: SkillListGroup): string[] =>
    group.rows[0]?.repository ? group.rows.map((row) => row.id) : []

/** The skills registry in the shared list frame; a repository heading carries Check for updates. */
export const SkillListTable = ({
    groups,
    view,
    group,
    isLoading,
    onOpen,
    empty,
    selectedKeys,
    onSelectionChange,
    flashKeys,
    collapsedKeys,
    onToggleGroup,
}: {
    groups: SkillListGroup[]
    view: ListTableView
    /** How the rows are cut — decides what the provenance column and a card's footer read. */
    group: SkillGrouping
    isLoading: boolean
    onOpen: (row: SkillListRow) => void
    empty: ReactNode
    /** The rows picked with their Mark, by workflow id. */
    selectedKeys: ReadonlySet<string>
    onSelectionChange: (next: Set<string>) => void
    /** Rows just imported, flashed once. */
    flashKeys?: ReadonlySet<string>
    /** Folded group keys; the screen holds them so select-all can skip folded rows. */
    collapsedKeys: ReadonlySet<string>
    onToggleGroup: (key: string) => void
}) => {
    const t = useT(skillsListCatalog)
    const narrow = !useMediaQuery(WIDE_QUERY)

    // Only a source group is one repository; ungrouped, the single run mixes sources.
    const groupActions = useCallback(
        (run: SkillListGroup) => {
            if (group !== "source") return null
            const ids = repositoryIds(run)
            return ids.length ? <SkillSourceUpdateAction ids={ids} /> : null
        },
        [group],
    )

    return (
        <ListTable
            columns={narrow ? narrowColumns(t) : wideColumns(t, group)}
            minWidth={narrow ? NARROW_MIN_WIDTH : WIDE_MIN_WIDTH}
            view={view}
            cardMinWidth={LIST_CARD_MIN_WIDTH}
            stickyHeader
            loading={isLoading}
            skeleton={{mark: true, heading: group === "source"}}
            groups={groups}
            rowKey={(row) => row.id}
            onOpenRow={onOpen}
            collapsedKeys={collapsedKeys}
            onToggleGroup={onToggleGroup}
            groupActions={groupActions}
            empty={empty}
            selection={{
                selectedKeys,
                onChange: onSelectionChange,
                rowLabel: (row) => t("skills.list.selectSkill", {name: row.title}),
                markAsCheckbox: true,
            }}
            flashKeys={flashKeys}
            renderRow={(row) => (
                <SkillRowCells row={row} narrow={narrow} group={group} onOpen={onOpen} />
            )}
            renderCard={(row) => <SkillCardBody row={row} group={group} onOpen={onOpen} />}
        />
    )
}
