import {useCallback, useState, type ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableView} from "@agenta/ui/list-table"
import {cn} from "@agenta/ui/styles"
import {Checkbox} from "@agenta/ui/ui"

import {SkillCardBody} from "./SkillCardBody"
import type {SkillGrouping, SkillListGroup, SkillListRow} from "./skillListView"
import {SkillRowCells} from "./SkillRowCells"
import {SkillSourceUpdateAction} from "./SkillSourceUpdateAction"

const WIDE_QUERY = "(min-width: 640px)"

const columns = (group: SkillGrouping, narrow: boolean, select: ReactNode): ListTableColumn[] => {
    const lead: ListTableColumn[] = [
        {key: "select", label: "Select", srOnly: true, width: "32px", header: select},
        {key: "name", label: "Name", width: "minmax(180px,2fr)"},
    ]
    const tail: ListTableColumn[] = [
        {key: "updated", label: "Last edited", width: "96px", headerClassName: "text-right"},
        {key: "actions", label: "Actions", srOnly: true, width: "32px"},
    ]
    if (narrow) return [...lead, ...tail]
    return [
        ...lead,
        {key: "usedBy", label: "Used by", width: "minmax(110px,1fr)"},
        {
            key: "provenance",
            label: group === "source" ? "Created by" : "Source",
            width: "minmax(120px,1fr)",
        },
        ...tail,
    ]
}

/** The skills registry as rows or cards, with a selectable tile on every skill. */
export const SkillListTable = ({
    groups,
    view,
    group,
    isLoading,
    selected,
    onSelect,
    fresh,
    onOpen,
    onArchive,
    empty,
}: {
    groups: SkillListGroup[]
    view: ListTableView
    group: SkillGrouping
    isLoading: boolean
    selected: ReadonlySet<string>
    onSelect: (next: Set<string>) => void
    /** Rows just imported: they flash once. */
    fresh: ReadonlySet<string>
    onOpen: (row: SkillListRow) => void
    onArchive: (row: SkillListRow) => void
    empty: ReactNode
}) => {
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

    const shown = groups.flatMap((run) => run.rows.map((row) => row.id))
    const picked = shown.filter((id) => selected.has(id)).length
    const allState = picked === 0 ? false : picked === shown.length ? true : "indeterminate"
    const toggleAll = () => onSelect(allState === true ? new Set() : new Set(shown))
    const toggle = (row: SkillListRow) => {
        const next = new Set(selected)
        if (!next.delete(row.id)) next.add(row.id)
        onSelect(next)
    }

    const selectAll = (
        <span className="flex w-8 justify-center">
            <Checkbox
                checked={allState}
                disabled={!shown.length}
                onCheckedChange={toggleAll}
                aria-label="Select all"
            />
        </span>
    )

    const groupActions = useCallback(
        (run: SkillListGroup) => {
            if (group !== "source" || !run.rows[0]?.repository) return null
            return <SkillSourceUpdateAction ids={run.rows.map((row) => row.id)} />
        },
        [group],
    )

    const rowProps = (row: SkillListRow) => ({
        row,
        group,
        checked: selected.has(row.id),
        onToggle: toggle,
        onOpen,
        onArchive,
    })

    return (
        <ListTable
            columns={columns(group, narrow, selectAll)}
            minWidth={narrow ? 320 : 640}
            view={view}
            cardMinWidth={280}
            stickyHeader
            density="compact"
            loading={isLoading}
            groups={groups}
            rowKey={(row) => row.id}
            onOpenRow={onOpen}
            collapsedKeys={collapsed}
            onToggleGroup={toggleGroup}
            groupActions={groupActions}
            empty={empty}
            wrapRow={(row, node) => (
                <div
                    className={cn(
                        "-mx-3 mb-0.5 w-[calc(100%+1.5rem)] rounded-md px-3 transition-colors",
                        selected.has(row.id) && "bg-accent",
                        fresh.has(row.id) && "animate-skill-fresh",
                    )}
                >
                    {node}
                </div>
            )}
            renderRow={(row) => <SkillRowCells {...rowProps(row)} narrow={narrow} />}
            renderCard={(row) => <SkillCardBody {...rowProps(row)} />}
        />
    )
}
