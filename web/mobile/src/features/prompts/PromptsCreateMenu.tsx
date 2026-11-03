import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {FolderPlusIcon, PlusIcon} from "@phosphor-icons/react"

import {promptsCopy} from "./promptsCopy"

/**
 * The "Create new" button. It offers New folder only for now; the prompt types come with the
 * playground. A reader who cannot edit folders gets no button.
 */
export const PromptsCreateMenu = ({
    canEditFolders,
    onNewFolder,
}: {
    canEditFolders: boolean
    onNewFolder: () => void
}) =>
    canEditFolders ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="sm"
                    className="h-control-sm rounded-control-sm px-btn-sm text-btn-sm sm:h-control sm:rounded-control sm:px-btn sm:text-btn-md"
                >
                    <PlusIcon size={14} />
                    {promptsCopy.createNew}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onNewFolder}>
                    <FolderPlusIcon size={16} />
                    {promptsCopy.newFolder}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null
