import {useMemo, type ReactNode, type RefObject} from "react"

import {ChatComposer} from "@agenta/chat/components"
import type {useComposerAttachments} from "@agenta/chat/hooks"
import {AgentChip} from "@agenta/entity-ui/agent"
import {Button} from "@agenta/ui/ui"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {RobotIcon, XIcon} from "@phosphor-icons/react"

export interface HomeTaskComposerAgent {
    id: string
    name: string
}

/** What the composer is for right now: running a task, or describing an agent to create. */
export type HomeComposerMode = "task" | "create"

export interface HomeTaskComposerProps {
    /** Pickable agents, most-recently-touched first — the head is the default selection. */
    agents: HomeTaskComposerAgent[]
    /** The attachment engine (staging + uploads); the host owns its rollout flag and scope. */
    attachments: ReturnType<typeof useComposerAttachments>
    /** Start the task. Called only with a resolved agent. */
    onStart: (input: {agentId: string; text: string}) => void | Promise<void>
    /** A rejected `onStart`. Without it the failure is swallowed — the composer has no toast. */
    onStartError?: (error: unknown) => void
    /** Host extras left of the paperclip (voice mic, context budget). */
    extraPrefix?: ReactNode
    /**
     * Pin the composer to one agent and drop the picker — an agent's own page already answers
     * "which agent", and a picker there would let you send from it to a different one.
     */
    fixedAgentId?: string
    /** Placeholder override; a pinned host names the agent it is talking to. */
    placeholder?: string
    /** The bound agent. The HOST owns the selection — Home's list is what changes it. */
    agentId?: string | null
    /**
     * `create` turns the same composer into "describe an agent": the picker becomes a cancellable
     * "New agent" pill and send creates instead of starting. A separate create composer beside
     * this one would be two inputs answering the same question in the same place.
     */
    mode?: HomeComposerMode
    /** Send, in create mode. Absent ⇒ the host does not offer creating here. */
    onCreate?: (input: {text: string}) => void | Promise<void>
    onCancelCreate?: () => void
    /** The input itself, for a host that needs to put the caret in it (switching to create). */
    inputRef?: RefObject<RichChatInputHandle | null>
}

const CREATE_PLACEHOLDER = "Describe the agent you want — what it does, when it runs…"

/**
 * Home's primary action: describe a task, pick the agent to run it, send.
 *
 * Which agent it is aimed at is NAMED in a strip docked under the input, not picked there: the
 * list below the composer is what binds one, and a dropdown here was a second way to do the same
 * thing that also hid the fact that the rows do it. The send button stays where it always is —
 * that affordance is the one the rest of the app teaches.
 *
 * Two modes, one input. `task` runs work with an agent that exists; `create` describes one to
 * make. Create used to live inside the picker as a hidden option, which meant send did two
 * different things depending on a selection you could not see — here the mode is a visible pill
 * with a way out of it.
 */
export const HomeTaskComposer = ({
    agents,
    attachments,
    onStart,
    onStartError,
    extraPrefix,
    fixedAgentId,
    placeholder = "Describe the task, or start the conversation…",
    agentId,
    mode = "task",
    onCreate,
    onCancelCreate,
    inputRef,
}: HomeTaskComposerProps) => {
    // Default to the most recently touched agent — the one you're most likely to want next.
    // A binding only counts while it is still in the list: an agent deleted (or filtered out)
    // under the composer otherwise left the strip blank and sent the task to an agent that is gone.
    const picked = agentId && agents.some((agent) => agent.id === agentId) ? agentId : null
    const effectiveAgentId = fixedAgentId ?? picked ?? agents[0]?.id ?? null
    const creating = mode === "create"

    const selectedName = useMemo(
        () => agents.find((agent) => agent.id === effectiveAgentId)?.name,
        [agents, effectiveAgentId],
    )

    const bound = creating ? (
        <span className="flex items-center gap-1.5 rounded-control bg-muted py-0.5 pl-1.5 pr-0.5 text-[13px] font-medium text-foreground">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-control-sm bg-colorFillSecondary text-muted-foreground">
                <RobotIcon aria-hidden size={13} />
            </span>
            New agent
            <Button
                variant="ghost"
                size="icon"
                className="size-5"
                aria-label="Cancel creating an agent"
                onClick={onCancelCreate}
            >
                <XIcon size={13} />
            </Button>
        </span>
    ) : fixedAgentId || !effectiveAgentId ? null : (
        // Named, not picked: the list below IS the picker, and a dropdown here offered a
        // second way to do the same thing while hiding that the rows do it.
        <span className="flex min-w-0 items-center gap-1.5 pl-1 text-[13px] font-medium text-foreground">
            <AgentChip workflowId={effectiveAgentId} box="size-5" glyph={13} />
            <span className="min-w-0 truncate">{selectedName}</span>
        </span>
    )

    return (
        <div className="relative flex flex-col">
            {/* Lifted, so the dock behind it stays behind it. */}
            <div className="relative z-10">
                <ChatComposer
                    inputRef={inputRef}
                    onSubmit={async (text) => {
                        try {
                            if (creating) {
                                await onCreate?.({text})
                                return
                            }
                            if (!effectiveAgentId) return
                            await onStart({agentId: effectiveAgentId, text})
                        } catch (error) {
                            // `ChatComposer.onSubmit` is fire-and-forget, so a rejecting host would
                            // surface as an unhandled rejection and nothing else.
                            onStartError?.(error)
                        }
                    }}
                    attachments={attachments}
                    placeholder={creating ? CREATE_PLACEHOLDER : placeholder}
                    disabled={!creating && !effectiveAgentId}
                    extraPrefix={extraPrefix}
                />
            </div>
            {/* Docked UNDER the composer, not inside its footer: what the message is aimed at is a
                standing fact about the composer, and in the footer it competed for the same row as
                the actions you take on this one message. It slides BEHIND the composer — same
                the divider step for a border — so the composer keeps its own shape and only the
                dock's sides and foot show below it. No top border: the composer's fill is 4%
                opaque, so a line tucked under it shows straight THROUGH rather than behind — its
                own bottom edge is the rule between them. */}
            {bound ? (
                <div className="-mt-3 flex items-center gap-2 rounded-b-lg border border-t-0 border-solid border-[var(--ag-colorSplit)] bg-transparent px-2.5 pb-2 pt-5">
                    {bound}
                </div>
            ) : null}
        </div>
    )
}
