import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {FolderPlusIcon, PlusIcon} from "@phosphor-icons/react"

import {NewPromptSubmenu} from "./NewPromptSubmenu"
import {promptsCopy} from "./promptsCopy"
import type {NewPromptAction} from "./useCreatePrompt"

/**
 * The "Create new" button: New prompt (Chat, Completion, Agent) and New folder. New prompt is
 * there only while `newPrompt` is set, which needs developer mode. A reader who can do neither
 * gets no button.
 */
export const PromptsCreateMenu = ({
    canEditFolders,
    onNewFolder,
    newPrompt,
}: {
    canEditFolders: boolean
    onNewFolder: () => void
    newPrompt: NewPromptAction | null
}) =>
    canEditFolders || newPrompt ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    size="sm"
                    disabled={newPrompt?.pending}
                    className="h-control-sm rounded-control-sm px-btn-sm text-btn-sm sm:h-control sm:rounded-control sm:px-btn sm:text-btn-md"
                >
                    <PlusIcon size={14} />
                    {promptsCopy.createNew}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {newPrompt ? (
                    <NewPromptSubmenu onNewPrompt={newPrompt.start} disabled={newPrompt.pending} />
                ) : null}
                {canEditFolders ? (
                    <DropdownMenuItem onSelect={onNewFolder}>
                        <FolderPlusIcon size={16} />
                        {promptsCopy.newFolder}
                    </DropdownMenuItem>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null
