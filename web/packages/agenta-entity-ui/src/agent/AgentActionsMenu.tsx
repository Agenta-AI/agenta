import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    Archive,
    Copy,
    DotsThreeVertical,
    Note,
    PencilSimple,
    TextAlignLeft,
} from "@phosphor-icons/react"

import {useAgentActions, type AgentActionTarget} from "./useAgentActions"

export interface AgentActionsMenuProps {
    agent: AgentActionTarget
    /**
     * Opens the agent's configuration. Omit on that page itself — a surface that cannot go
     * anywhere must not offer the trip.
     */
    onOpen?: () => void
    /**
     * Host overrides. The desktop has its own app-management modals (which also refresh its apps
     * cache), so it passes them; a host without one falls through to [[useAgentActions]].
     */
    onRename?: () => void
    /** Edits the description in place. Absent means no item: the desktop edits it in its rename modal. */
    onEditDescription?: () => void
    /** Named for the prop's history; the verb it stands for is Archive. */
    onDelete?: () => void
    /** Custom-workflow "Configure" — only the desktop has that flow, so absent means no item. */
    onConfigure?: () => void
    /** Which edge the menu hangs from. A trigger near the right edge wants `end`. */
    align?: "start" | "end"
    /** The close's focus restore. A host whose rename mounts an editor suppresses it here. */
    onCloseAutoFocus?: (event: Event) => void
    className?: string
}

/**
 * THE agent kebab: open, rename, copy slug, archive. One definition for the desktop overview
 * header and the mobile screens, so they can't offer different verbs for the same object.
 * Copying is entirely the menu's business; open, rename and archive defer to the host — and an
 * entry whose handler is missing is dropped rather than offered dead.
 */
export const AgentActionsMenu = ({
    agent,
    onOpen,
    onRename,
    onEditDescription,
    onDelete,
    onConfigure,
    align = "start",
    onCloseAutoFocus,
    className,
}: AgentActionsMenuProps) => {
    const actions = useAgentActions()

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label="Agent actions"
                    // ::after hit extender: 28px is under the touch guideline.
                    className={`relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-colorTextSecondary after:absolute after:-inset-1.5 after:content-[''] hover:bg-colorFillTertiary hover:text-colorText ${className ?? ""}`}
                >
                    <DotsThreeVertical size={16} weight="bold" />
                </button>
            </DropdownMenuTrigger>
            {/* Sized to its longest verb rather than to a number: at a fixed 180 "Open
                configuration" wrapped to two lines and stood twice as tall as the rows under it. */}
            <DropdownMenuContent
                align={align}
                onCloseAutoFocus={onCloseAutoFocus}
                className="w-max min-w-[180px]"
            >
                {onOpen ? (
                    <DropdownMenuItem onSelect={onOpen}>
                        <Note size={16} />
                        Open configuration
                    </DropdownMenuItem>
                ) : null}
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
                {onEditDescription ? (
                    <DropdownMenuItem onSelect={onEditDescription}>
                        <TextAlignLeft size={16} />
                        Edit description
                    </DropdownMenuItem>
                ) : null}
                {agent.slug ? (
                    <DropdownMenuItem onSelect={() => void actions.copy(agent.slug!, "Slug")}>
                        <Copy size={16} />
                        Copy Slug
                    </DropdownMenuItem>
                ) : null}
                {/* Set apart: everything above is reversible in a keystroke, and this one takes
                    the agent off the roster. */}
                <DropdownMenuSeparator />
                {/* Archive, not Delete: the verb behind it has always been `archiveWorkflow`,
                    and the modal it opens is already titled "Archive". */}
                <DropdownMenuItem
                    className="!text-colorError"
                    onSelect={onDelete ?? (() => actions.remove(agent))}
                >
                    <Archive size={16} />
                    Archive agent
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
