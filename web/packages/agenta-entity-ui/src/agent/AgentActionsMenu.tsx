import {useT} from "@agenta/i18n"
import agentActionsCatalog from "@agenta/i18n/catalogs/entityUi.agentActions"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    Archive,
    Broadcast,
    Copy,
    DotsThreeVertical,
    ArrowCounterClockwise,
    Note,
    PencilSimple,
    Rocket,
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
    /** Opens the agent's Publish panel. Absent means no item. */
    onPublish?: () => void
    /**
     * Host overrides. A host without one falls through to [[useAgentActions]].
     */
    onRename?: () => void
    /** Edits the description in place. Absent means no item. */
    onEditDescription?: () => void
    /** Named for the prop's history; the verb it stands for is Archive. */
    onDelete?: () => void
    /** Custom-workflow "Configure". Absent means no item. */
    onConfigure?: () => void
    /** Opens a chat with the agent. Absent means no item. */
    onOpenPlayground?: () => void
    /** The agent is archived: Rename, Configure and Archive agent do not apply to it. */
    archived?: boolean
    /** Restores an archived agent. Absent means no Restore, for a reader who may not. */
    onRestore?: () => void
    /** False hides Archive agent, for a reader who may not archive. Defaults to true. */
    canArchive?: boolean
    /** Which edge the menu hangs from. A trigger near the right edge wants `end`. */
    align?: "start" | "end"
    /** The close's focus restore. A host whose rename mounts an editor suppresses it here. */
    onCloseAutoFocus?: (event: Event) => void
    className?: string
}

/**
 * THE agent kebab: open, open in playground, rename, copy slug, archive, and restore for an
 * archived agent. One definition for every screen, so they can't offer different verbs for the same
 * object.
 * Copying is entirely the menu's business; open, rename and archive defer to the host — and an
 * entry whose handler is missing is dropped rather than offered dead.
 */
export const AgentActionsMenu = ({
    agent,
    onOpen,
    onPublish,
    onRename,
    onEditDescription,
    onDelete,
    onConfigure,
    onOpenPlayground,
    archived = false,
    onRestore,
    canArchive = true,
    align = "start",
    onCloseAutoFocus,
    className,
}: AgentActionsMenuProps) => {
    const t = useT(agentActionsCatalog)
    const actions = useAgentActions()

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={t("entityUi.agentActions.agentActions")}
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
                        {t("entityUi.agentActions.openConfiguration")}
                    </DropdownMenuItem>
                ) : null}
                {onOpenPlayground ? (
                    <DropdownMenuItem onSelect={onOpenPlayground}>
                        <Rocket size={16} />
                        {t("entityUi.agentActions.openInPlayground")}
                    </DropdownMenuItem>
                ) : null}
                {onPublish ? (
                    <DropdownMenuItem onSelect={onPublish}>
                        <Broadcast size={16} />
                        {t("entityUi.agentActions.publish")}
                    </DropdownMenuItem>
                ) : null}
                {archived ? null : onConfigure ? (
                    <DropdownMenuItem onSelect={onConfigure}>
                        <PencilSimple size={16} />
                        {t("entityUi.agentActions.configure")}
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem onSelect={onRename ?? (() => actions.rename(agent))}>
                        <PencilSimple size={16} />
                        {t("entityUi.agentActions.rename")}
                    </DropdownMenuItem>
                )}
                {onEditDescription ? (
                    <DropdownMenuItem onSelect={onEditDescription}>
                        <TextAlignLeft size={16} />
                        {t("entityUi.agentActions.editDescription")}
                    </DropdownMenuItem>
                ) : null}
                {agent.slug ? (
                    <DropdownMenuItem
                        onSelect={() =>
                            void actions.copy(agent.slug!, {
                                copied: t("entityUi.agentActions.slugCopied"),
                                failed: t("entityUi.agentActions.couldNotCopySlug"),
                            })
                        }
                    >
                        <Copy size={16} />
                        {t("entityUi.agentActions.copySlug")}
                    </DropdownMenuItem>
                ) : null}
                {archived ? (
                    onRestore ? (
                        <DropdownMenuItem onSelect={onRestore}>
                            <ArrowCounterClockwise size={16} />
                            {t("entityUi.agentActions.restore")}
                        </DropdownMenuItem>
                    ) : null
                ) : canArchive ? (
                    <>
                        {/* Set apart: everything above is reversible in a keystroke, and this one
                            takes the agent off the roster. */}
                        <DropdownMenuSeparator />
                        {/* Archive, not Delete: the verb behind it has always been
                            `archiveWorkflow`, and the modal it opens is already titled "Archive". */}
                        <DropdownMenuItem
                            className="!text-colorError"
                            onSelect={onDelete ?? (() => actions.remove(agent))}
                        >
                            <Archive size={16} />
                            {t("entityUi.agentActions.archiveAgent")}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
