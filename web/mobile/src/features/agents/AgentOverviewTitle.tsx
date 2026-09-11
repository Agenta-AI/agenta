import {useCallback} from "react"

import {
    AgentActionsMenu,
    AgentChip,
    AgentIconPopover,
    useRenameAgent,
    useUpdateAgentDescription,
} from "@agenta/entity-ui/agent"
import {InlineRenameInput, useDeferredMenuSelect, useInlineRename} from "@agenta/sessions-ui"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ChatCircleDots} from "@phosphor-icons/react"

import {Button} from "@/components/ui/button"
import {Skeleton} from "@/components/ui/skeleton"
import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

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
    // The description edits the same way, one line under the name. Blank is a real value here:
    // it is how a description is removed.
    const updateDescription = useUpdateAgentDescription()
    const onCommitDescription = useCallback(
        (next: string) => updateDescription(agentId, next),
        [agentId, updateDescription],
    )
    const describe = useInlineRename({
        current: description ?? "",
        onCommit: onCommitDescription,
        errorText: "Couldn't update this agent's description",
        allowEmpty: true,
    })
    // The editor must not mount inside the menu's focus trap, so the verb runs from the close.
    const {handleSelect, handleCloseAutoFocus} = useDeferredMenuSelect((key) => {
        if (key === "rename") return () => rename.start()
        if (key === "describe") return () => describe.start()
    })
    // Tailwind's `lg`, where the rail sits beside the list and the header has room for the rest.
    const wide = useMediaQuery("(min-width: 1024px)")

    return (
        <>
            {/* The row is top-aligned so a two-line description hangs under the title rather
                than pushing everything to its middle. Below `lg` each control nudges down so its
                centre sits on the title line; from `lg` the tile's top edge sits on the title's
                glyphs. */}
            <AgentIconPopover workflowId={agentId}>
                {/* The playground bar's 24px below `lg`, the roster's 32 beside the rail. `mt-1` puts
                    its top on the title's cap height, not on the line box above it. */}
                <AgentChip workflowId={agentId} box="mt-1 size-6 lg:size-8" glyph={16} />
            </AgentIconPopover>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1 lg:pt-0">
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
                {/* Only from `lg`, beside the rail. One line, never wider than the composer
                    column beneath it: the rail takes a third of the page plus the 40px gap, so
                    the line stops there. Below `lg` the header is the name alone. */}
                {pending || !wide ? null : describe.renaming ? (
                    <InlineRenameInput
                        rename={describe}
                        ariaLabel="Agent description"
                        className="h-6 w-full min-w-0 rounded-md border border-solid border-input bg-background px-2 text-[13px] leading-none text-foreground shadow-xs outline-none transition-[color,box-shadow] [font-family:inherit] selection:bg-primary selection:text-primary-foreground focus:border-ring focus:ring-[3px] focus:ring-ring/50 dark:bg-input/30 lg:max-w-[calc(66.667%-40px)]"
                    />
                ) : (
                    // A button either way: the text is its own edit affordance, and an agent
                    // with no description gets the same line as a prompt, so the header keeps
                    // one shape.
                    <button
                        type="button"
                        onClick={describe.start}
                        title={description ?? "Add a description"}
                        className={cn(
                            "m-0 min-w-0 cursor-text truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[13px] leading-snug outline-none sm:text-[14px] lg:max-w-[calc(66.667%-40px)]",
                            FOCUS_RING,
                            description ? "text-muted-foreground" : "text-placeholder",
                        )}
                    >
                        {description ?? "Add a description"}
                    </button>
                )}
            </div>
            {/* Only beside the rail: a narrower header has no room, and the composer is the same verb. */}
            <Button
                type="button"
                variant="outline"
                // `sm` is 32px — the filter trigger's height, and what the other page headers use.
                size="sm"
                onClick={onOpenChat}
                className="hidden shrink-0 lg:inline-flex"
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
                    onEditDescription={wide ? () => handleSelect("describe") : undefined}
                    onCloseAutoFocus={handleCloseAutoFocus}
                    className="mt-0.5 lg:mt-0.5"
                />
            )}
        </>
    )
}
