import {useCallback, type ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"

import type {AppRevisionRow} from "./useAppRevisions"
import {VariantRowCells} from "./VariantRowCells"

const NAME: ListTableColumn = {key: "name", label: "Name", width: "minmax(160px,2fr)"}
const CREATED_ON = (width: string): ListTableColumn => ({
    key: "createdOn",
    label: "Created on",
    width,
})
const ACTIONS: ListTableColumn = {key: "actions", label: "Actions", srOnly: true, width: "24px"}

const WIDE_COLUMNS: ListTableColumn[] = [
    NAME,
    {key: "model", label: "Model", width: "minmax(90px,1fr)"},
    CREATED_ON("110px"),
    {key: "createdBy", label: "Created by", width: "minmax(100px,1fr)"},
    {key: "notes", label: "Commit notes", width: "minmax(120px,2fr)"},
    ACTIONS,
]
const NARROW_COLUMNS: ListTableColumn[] = [NAME, CREATED_ON("104px"), ACTIONS]

/** Tailwind's `sm`. Below it only Name and Created on stay. */
const WIDE_QUERY = "(min-width: 640px)"

/** The revisions of one app, flat or grouped by variant, in the shared list frame. */
export const VariantsTable = ({
    groups,
    isLoading,
    latestRevisionId,
    canDeploy,
    canDelete,
    collapsed,
    onCollapsedChange,
    onOpen,
    onDeploy,
    onDelete,
    empty,
}: {
    groups: ListTableGroup<AppRevisionRow>[]
    isLoading: boolean
    latestRevisionId: string | null
    canDeploy: boolean
    canDelete: boolean
    collapsed: ReadonlySet<string>
    onCollapsedChange: (next: Set<string>) => void
    onOpen: (row: AppRevisionRow) => void
    onDeploy: (row: AppRevisionRow) => void
    onDelete: (row: AppRevisionRow) => void
    empty: ReactNode
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const toggleGroup = useCallback(
        (key: string) => {
            const next = new Set(collapsed)
            if (!next.delete(key)) next.add(key)
            onCollapsedChange(next)
        },
        [collapsed, onCollapsedChange],
    )

    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? 300 : 760}
            stickyHeader
            loading={isLoading}
            groups={groups}
            rowKey={(row) => row.revisionId}
            onOpenRow={onOpen}
            collapsedKeys={collapsed}
            onToggleGroup={toggleGroup}
            empty={empty}
            renderRow={(row) => (
                <VariantRowCells
                    row={row}
                    narrow={narrow}
                    isLatest={row.revisionId === latestRevisionId}
                    canDeploy={canDeploy}
                    canDelete={canDelete}
                    onOpen={onOpen}
                    onDeploy={onDeploy}
                    onDelete={onDelete}
                />
            )}
        />
    )
}
