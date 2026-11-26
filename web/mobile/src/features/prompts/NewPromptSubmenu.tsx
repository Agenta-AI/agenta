import type {AppType} from "@agenta/entities/workflow"
import {
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from "@agenta/ui/ui"
import {ChatDotsIcon, NoteIcon, RobotIcon, SquaresFourIcon, type Icon} from "@phosphor-icons/react"

import {promptsCopy} from "./promptsCopy"

/** The prompt types the old app offers, in its order. */
const PROMPT_TYPES: readonly {type: AppType; Icon: Icon}[] = [
    {type: "chat", Icon: ChatDotsIcon},
    {type: "completion", Icon: NoteIcon},
    {type: "agent", Icon: RobotIcon},
]

/**
 * "New prompt" with its Chat, Completion and Agent items, for the Create new menu and the folder
 * menu. Items are off while a new prompt is being set up.
 */
export const NewPromptSubmenu = ({
    onNewPrompt,
    disabled,
}: {
    onNewPrompt: (type: AppType) => void
    disabled: boolean
}) => (
    <DropdownMenuSub>
        <DropdownMenuSubTrigger>
            <SquaresFourIcon size={16} />
            {promptsCopy.newPrompt}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
            {PROMPT_TYPES.map(({type, Icon}) => (
                <DropdownMenuItem key={type} disabled={disabled} onSelect={() => onNewPrompt(type)}>
                    <Icon size={16} />
                    {promptsCopy.promptTypes[type]}
                </DropdownMenuItem>
            ))}
        </DropdownMenuSubContent>
    </DropdownMenuSub>
)
