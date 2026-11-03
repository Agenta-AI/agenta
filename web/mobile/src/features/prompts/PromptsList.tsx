import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"

import type {PromptsRow} from "./promptRow"
import type {PromptRowActions} from "./promptRowActions"
import {PromptRowCells} from "./PromptRowCells"
import {promptsCopy} from "./promptsCopy"

const NAME: ListTableColumn = {
    key: "name",
    label: promptsCopy.columns.name,
    width: "minmax(160px,2fr)",
}
const MODIFIED: ListTableColumn = {
    key: "modified",
    label: promptsCopy.columns.modified,
    width: "minmax(150px,1fr)",
}
const TYPE: ListTableColumn = {key: "type", label: promptsCopy.columns.type, width: "96px"}
const ACTIONS: ListTableColumn = {
    key: "actions",
    label: promptsCopy.columns.actions,
    srOnly: true,
    width: "24px",
}

const WIDE_COLUMNS = [NAME, MODIFIED, TYPE, ACTIONS]
const NARROW_COLUMNS = [NAME, TYPE, ACTIONS]
/** Tailwind's `sm`. Below it the date column goes, as on the agents list. */
const WIDE_QUERY = "(min-width: 640px)"

/**
 * The folders and prompts of the open folder, or the search result. A folder row opens its
 * folder. A prompt row does nothing yet: there is no prompt page in this app, so it is neither
 * a link nor clickable.
 */
export const PromptsList = ({
    rows,
    isLoading,
    empty,
    canEditFolders,
    canEditPrompts,
    actions,
}: {
    rows: PromptsRow[]
    isLoading: boolean
    empty: ReactNode
    canEditFolders: boolean
    canEditPrompts: boolean
    actions: PromptRowActions
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)

    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? 300 : 460}
            stickyHeader
            loading={isLoading}
            groups={[{key: "all", label: null, rows}]}
            rowKey={(row) => row.key}
            onOpenRow={(row) => {
                if (row.kind === "folder") actions.openFolder(row)
            }}
            canOpenRow={(row) => row.kind === "folder"}
            empty={empty}
            renderRow={(row) => (
                <PromptRowCells
                    row={row}
                    narrow={narrow}
                    canEditFolders={canEditFolders}
                    canEditPrompts={canEditPrompts}
                    actions={actions}
                />
            )}
        />
    )
}
