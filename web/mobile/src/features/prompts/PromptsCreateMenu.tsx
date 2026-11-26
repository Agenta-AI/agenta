import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {FlowArrowIcon, FolderPlusIcon, PlusIcon} from "@phosphor-icons/react"

import {NewPromptSubmenu} from "./NewPromptSubmenu"
import {promptsCopy} from "./promptsCopy"
import type {NewPromptAction} from "./useCreatePrompt"

/**
 * The "Create new" button: New prompt (Chat, Completion, Agent), New folder and Set up workflow.
 * New prompt and Set up workflow need developer mode. A reader who can do none of them gets no
 * button.
 */
export const PromptsCreateMenu = ({
    canEditFolders,
    onNewFolder,
    newPrompt,
    onSetupWorkflow,
}: {
    canEditFolders: boolean
    onNewFolder: () => void
    newPrompt: NewPromptAction | null
    /** Set up workflow; null without developer mode, like `newPrompt`. */
    onSetupWorkflow: (() => void) | null
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
                {onSetupWorkflow ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={onSetupWorkflow}>
                            <FlowArrowIcon size={16} />
                            {promptsCopy.setupWorkflow}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null
