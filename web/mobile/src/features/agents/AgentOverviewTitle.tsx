import {useCallback} from "react"

import {
    AgentActionsMenu,
    AgentChip,
    AgentIconPopover,
    useRenameAgent,
} from "@agenta/entity-ui/agent"
import {InlineRenameInput, useDeferredMenuSelect, useInlineRename} from "@agenta/sessions-ui"
import {ChatCircleDots} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"
import {Skeleton} from "@/components/ui/skeleton"

/**
 * Who the agent is, as the overview's header row: the roster's tile (icon picker behind it), the
 * name renaming in place the way a roster row does, the description under it, then Open chat
 * and the shared kebab. The kebab's Rename starts the editor here rather than a modal.
 */
export const AgentOverviewTitle = ({
    agentId,
    name,
    description,
    pending,
    onOpenChat,
}: {
    agentId: string
    name: string
    description: string | null
    /** The roster is still in flight and the record has not landed. */
    pending: boolean
    onOpenChat: () => void
}) => {
    const renameAgent = useRenameAgent()
    const onCommit = useCallback(
        (next: string) => renameAgent(agentId, next),
        [agentId, renameAgent],
    )
    const rename = useInlineRename({
        current: name,
        onCommit,
        errorText: "Couldn't rename this agent",
    })
    // The editor must not mount inside the menu's focus trap, so the verb runs from the close.
    const {handleSelect, handleCloseAutoFocus} = useDeferredMenuSelect((key) => {
        if (key === "rename") return () => rename.start()
    })

    return (
        <>
            {/* The row is top-aligned so a two-line description hangs under the title rather
                than pushing everything to its middle. On a phone each control nudges down so its
                centre sits on the title line; from `sm` the tile's top edge sits on the title's. */}
            <AgentIconPopover workflowId={agentId}>
                {/* The playground bar's 24px on a phone, the roster's 32 from `sm`. */}
                <AgentChip workflowId={agentId} box="mt-1 size-6 sm:mt-0 sm:size-8" glyph={16} />
            </AgentIconPopover>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1 sm:pt-0">
                {pending ? (
                    <Skeleton className="h-7 w-40" />
                ) : rename.renaming ? (
                    <InlineRenameInput
                        rename={rename}
                        ariaLabel="Agent name"
                        className="h-7 w-full min-w-0 rounded-md border border-solid border-input bg-background px-2 text-[16px] font-semibold leading-none text-foreground shadow-xs outline-none transition-[color,box-shadow] [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30"
                    />
                ) : (
                    <h1
                        className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[18px] sm:leading-[1.3]"
                        title={name}
                        onDoubleClick={rename.start}
                    >
                        {name}
                    </h1>
                )}
                {description ? (
                    <p className="m-0 line-clamp-2 text-[13px] leading-snug text-muted-foreground sm:text-[14px]">
                        {description}
                    </p>
                ) : null}
            </div>
            {/* A phone's header has no room beside the name; the composer below is the same verb. */}
            <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={onOpenChat}
                className="hidden shrink-0 sm:inline-flex"
            >
                <ChatCircleDots aria-hidden />
                Open chat
            </Button>
            {/* Held back until the record lands: until then the destructive verbs would act on
                an agent whose name is unknown. No slug on purpose: the menu offers Copy Slug only
                when it has one, and this screen does not want it. */}
            {pending ? null : (
                <AgentActionsMenu
                    agent={{id: agentId, name}}
                    align="end"
                    onRename={() => handleSelect("rename")}
                    onCloseAutoFocus={handleCloseAutoFocus}
                    className="mt-0.5 sm:-mt-0.5"
                />
            )}
        </>
    )
}
