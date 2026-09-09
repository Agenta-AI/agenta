import {useMemo, useState, type ReactNode} from "react"

import {ChatComposer} from "@agenta/chat/components"
import type {useComposerAttachments} from "@agenta/chat/hooks"
import {AgentPicker} from "@agenta/entity-ui/agent"
import {Button} from "@agenta/ui/ui"
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
    /** The bound agent, when the host drives the selection (Home's list binds it by clicking). */
    agentId?: string | null
    onAgentChange?: (agentId: string) => void
    /**
     * `create` turns the same composer into "describe an agent": the picker becomes a cancellable
     * "New agent" pill and send creates instead of starting. A separate create composer beside
     * this one would be two inputs answering the same question in the same place.
     */
    mode?: HomeComposerMode
    /** Send, in create mode. Absent ⇒ the host does not offer creating here. */
    onCreate?: (input: {text: string}) => void | Promise<void>
    onCancelCreate?: () => void
}

const CREATE_PLACEHOLDER = "Describe the agent you want — what it does, when it runs…"

/**
 * Home's primary action: describe a task, pick the agent to run it, send.
 *
 * The picker rides the composer's prefix (left), leaving the send button where it always is —
 * the send affordance is the one the rest of the app teaches, and a bespoke "Start" button
 * beside it would be a second way to do the same thing. The picker is the app's ONE
 * `AgentPicker`, not a local select: a second list of the same agents is how two surfaces stop
 * agreeing on what an agent looks like.
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
    agentId: controlledAgentId,
    onAgentChange,
    mode = "task",
    onCreate,
    onCancelCreate,
}: HomeTaskComposerProps) => {
    const [ownAgentId, setOwnAgentId] = useState<string | null>(null)
    const agentId = controlledAgentId !== undefined ? controlledAgentId : ownAgentId

    // Default to the most recently touched agent — the one you're most likely to want next.
    // A pick only counts while it is still in the list: an agent deleted (or filtered out) under
    // the composer otherwise left the trigger blank and sent the task to an agent that is gone.
    const picked = agentId && agents.some((agent) => agent.id === agentId) ? agentId : null
    const effectiveAgentId = fixedAgentId ?? picked ?? agents[0]?.id ?? null
    const creating = mode === "create"

    const setAgentId = useMemo(
        () => onAgentChange ?? setOwnAgentId,
        [onAgentChange],
    )

    return (
        <ChatComposer
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
            extraPrefix={
                creating ? (
                    <span className="flex items-center gap-1 rounded-control bg-muted py-1 pl-2 pr-1 text-[13px] font-medium text-foreground">
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
                        {extraPrefix}
                    </span>
                ) : fixedAgentId ? (
                    extraPrefix
                ) : (
                    <span className="flex items-center gap-1">
                        <AgentPicker
                            trigger="pill"
                            density="compact"
                            value={effectiveAgentId}
                            onChange={setAgentId}
                            triggerAriaLabel="Agent"
                            // The composer's own surface already reads as a field; a filled pill
                            // inside it makes a second box within a box.
                            triggerClassName="bg-transparent hover:bg-muted"
                        />
                        {extraPrefix}
                    </span>
                )
            }
        />
    )
}
