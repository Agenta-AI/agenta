import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    DotsThreeVerticalIcon,
    FolderDashedIcon,
    FolderOpenIcon,
    PencilSimpleIcon,
    TrashIcon,
} from "@phosphor-icons/react"

import type {PromptsRow} from "./promptRow"
import type {PromptRowActions} from "./promptRowActions"
import {promptsCopy} from "./promptsCopy"

/**
 * A row's kebab. A folder always offers Open; the other verbs need the write permission for
 * what the row is. A row with no verb has no kebab.
 */
export const PromptRowMenu = ({
    row,
    canWrite,
    actions,
}: {
    row: PromptsRow
    /** `edit_folders` for a folder row, `edit_workflows` for a prompt row. */
    canWrite: boolean
    actions: PromptRowActions
}) => {
    const copy = promptsCopy.menu
    const isFolder = row.kind === "folder"
    if (!isFolder && !canWrite) return null

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={promptsCopy.rowMenuLabel}
                    className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground after:absolute after:-inset-1.5 after:content-[''] hover:bg-accent hover:text-foreground"
                >
                    <DotsThreeVerticalIcon size={16} weight="bold" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max min-w-[160px]">
                {row.kind === "folder" ? (
                    <DropdownMenuItem onSelect={() => actions.openFolder(row)}>
                        <FolderOpenIcon size={16} />
                        {copy.open}
                    </DropdownMenuItem>
                ) : null}
                {canWrite ? (
                    <>
                        <DropdownMenuItem onSelect={() => actions.rename(row)}>
                            <PencilSimpleIcon size={16} />
                            {copy.rename}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => actions.move(row)}>
                            <FolderDashedIcon size={16} />
                            {copy.move}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => actions.remove(row)}
                        >
                            <TrashIcon size={16} />
                            {isFolder ? copy.delete : copy.archive}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
