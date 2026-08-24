import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Copy, DotsThreeVertical, PencilSimple, Trash} from "@phosphor-icons/react"

import {useAgentActions, type AgentActionTarget} from "./useAgentActions"

export interface AgentActionsMenuProps {
    agent: AgentActionTarget
    /**
     * Host overrides. The desktop has its own app-management modals (which also refresh its apps
     * cache), so it passes them; a host without one falls through to [[useAgentActions]].
     */
    onRename?: () => void
    onDelete?: () => void
    /** Custom-workflow "Configure" — only the desktop has that flow, so absent means no item. */
    onConfigure?: () => void
    className?: string
}

/**
 * THE agent kebab: rename, copy id, copy slug, delete. One definition for the desktop overview
 * header and the mobile screen, so the two can't offer different verbs for the same object.
 * Copying is entirely the menu's business; rename and delete defer to the host when it has a
 * richer flow.
 */
export const AgentActionsMenu = ({
    agent,
    onRename,
    onDelete,
    onConfigure,
    className,
}: AgentActionsMenuProps) => {
    const actions = useAgentActions()

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Agent actions"
                    className={`flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText ${className ?? ""}`}
                >
                    <DotsThreeVertical size={16} weight="bold" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[180px]">
                {onConfigure ? (
                    <DropdownMenuItem onSelect={onConfigure}>
                        <PencilSimple size={16} />
                        Configure
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem onSelect={onRename ?? (() => actions.rename(agent))}>
                        <PencilSimple size={16} />
                        Rename
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void actions.copy(agent.id, "ID")}>
                    <Copy size={16} />
                    Copy ID
                </DropdownMenuItem>
                {agent.slug ? (
                    <DropdownMenuItem onSelect={() => void actions.copy(agent.slug!, "Slug")}>
                        <Copy size={16} />
                        Copy Slug
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                    className="!text-colorError"
                    onSelect={onDelete ?? (() => actions.remove(agent))}
                >
                    <Trash size={16} />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
