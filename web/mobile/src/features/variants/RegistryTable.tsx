import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableSelection} from "@agenta/ui/list-table"

import {RegistryRowCells} from "./RegistryRowCells"
import type {RegistryRow} from "./registryRows"
import type {AppRevisionRow} from "./useAppRevisions"

const NAME: ListTableColumn = {key: "name", label: "Name", width: "minmax(200px,2fr)"}
const ACTIONS: ListTableColumn = {key: "actions", label: "Actions", srOnly: true, width: "24px"}
const WIDE_COLUMNS: ListTableColumn[] = [
    NAME,
    {key: "model", label: "Model", width: "minmax(140px,1.4fr)"},
    {key: "createdOn", label: "Created on", width: "minmax(150px,1fr)"},
    {key: "createdBy", label: "Created by", width: "minmax(130px,1fr)"},
    {key: "notes", label: "Commit notes", width: "minmax(100px,1fr)"},
    ACTIONS,
]
const NARROW_COLUMNS: ListTableColumn[] = [
    NAME,
    {key: "createdOn", label: "Created on", width: "104px"},
    ACTIONS,
]

/** Tailwind's `sm`. Below it only Name and Created on stay. */
const WIDE_QUERY = "(min-width: 640px)"

/** The beta developer mode Registry: the old app's columns, row selection, expandable variants. */
export const RegistryTable = ({
    rows,
    isLoading,
    latestRevisionId,
    expanded,
    onToggle,
    selection,
    canDeploy,
    canDelete,
    playgroundHref,
    onOpen,
    onDeploy,
    onDelete,
    empty,
}: {
    rows: RegistryRow[]
    isLoading: boolean
    latestRevisionId: string | null
    /** Expanded variant ids. */
    expanded: ReadonlySet<string>
    onToggle: (variantId: string) => void
    selection: ListTableSelection<RegistryRow>
    canDeploy: boolean
    canDelete: boolean
    playgroundHref: ((row: AppRevisionRow) => string) | null
    onOpen: (row: AppRevisionRow) => void
    onDeploy: (row: AppRevisionRow) => void
    onDelete: (row: RegistryRow) => void
    empty: ReactNode
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const variantIdOf = (row: RegistryRow) => row.revision.variantId || row.revision.variantName
    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? 300 : 860}
            stickyHeader
            loading={isLoading}
            groups={rows.length ? [{key: "all", label: null, rows}] : []}
            rowKey={(row) => row.key}
            onOpenRow={(row) => onOpen(row.revision)}
            selection={selection}
            empty={empty}
            renderRow={(row) => (
                <RegistryRowCells
                    row={row}
                    narrow={narrow}
                    isLatest={row.revision.revisionId === latestRevisionId}
                    expanded={expanded.has(variantIdOf(row))}
                    onToggle={() => onToggle(variantIdOf(row))}
                    canDeploy={canDeploy}
                    canDelete={canDelete}
                    playgroundHref={playgroundHref}
                    onOpen={onOpen}
                    onDeploy={onDeploy}
                    onDelete={onDelete}
                />
            )}
        />
    )
}
