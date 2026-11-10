import {workflowAppTypeAtomFamily} from "@agenta/entities/workflow"
import {WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {Badge} from "@agenta/ui/ui"
import {FolderIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AppTypeIcon} from "@/components/AppTypeIcon"

import type {PromptsRow} from "./promptRow"
import type {PromptRowActions} from "./promptRowActions"
import {PromptRowMenu} from "./PromptRowMenu"
import {promptsCopy} from "./promptsCopy"

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
})

const modifiedLabel = (row: PromptsRow): string => {
    const raw =
        row.kind === "folder"
            ? (row.folder.updated_at ?? row.folder.created_at)
            : (row.prompt.updated_at ?? row.prompt.created_at)
    const date = raw ? new Date(raw) : null
    return date && !Number.isNaN(date.getTime()) ? DATE_FORMAT.format(date) : "—"
}

/** One row's cells, in column order. A narrow screen drops the date column. */
export const PromptRowCells = ({
    row,
    narrow,
    canEditFolders,
    canEditPrompts,
    actions,
}: {
    row: PromptsRow
    narrow: boolean
    canEditFolders: boolean
    canEditPrompts: boolean
    actions: PromptRowActions
}) => {
    const name =
        row.kind === "folder"
            ? row.folder.name || promptsCopy.deleteDialog.fallbackName
            : row.prompt.name || row.prompt.slug || ""
    // The list flags carry no chat flag, so the type comes from the latest revision, as in /w.
    // A folder row passes no id, and the query stays off.
    const appType = useAtomValue(
        workflowAppTypeAtomFamily(row.kind === "prompt" ? row.prompt.id : ""),
    )

    return (
        <>
            <span className="flex min-w-0 items-center gap-2" style={{paddingLeft: row.depth * 16}}>
                {row.kind === "folder" ? (
                    <FolderIcon size={18} className="shrink-0 text-muted-foreground" />
                ) : (
                    <AppTypeIcon appType={appType} />
                )}
                <span
                    className="truncate text-[14px] font-medium leading-[18px] text-foreground"
                    title={name}
                >
                    {name}
                </span>
            </span>
            {narrow ? null : (
                <span className="block truncate text-[13px] text-muted-foreground">
                    {modifiedLabel(row)}
                </span>
            )}
            <span className="flex min-w-0">
                {row.kind === "folder" ? (
                    <Badge variant="outlined">{promptsCopy.folderTag}</Badge>
                ) : (
                    <WorkflowTypeTag isEvaluator={false} workflowType={appType} />
                )}
            </span>
            <span
                className="flex justify-end"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                <PromptRowMenu
                    row={row}
                    canWrite={row.kind === "folder" ? canEditFolders : canEditPrompts}
                    actions={actions}
                />
            </span>
        </>
    )
}
