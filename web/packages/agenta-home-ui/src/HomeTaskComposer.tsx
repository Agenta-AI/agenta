import {useMemo, useState, type ReactNode} from "react"

import {ChatComposer} from "@agenta/chat/components"
import type {useComposerAttachments} from "@agenta/chat/hooks"
import {AgentGlyph} from "@agenta/entity-ui/agent"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"
import {RobotIcon} from "@phosphor-icons/react"

export interface HomeTaskComposerAgent {
    id: string
    name: string
}

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
}

/**
 * Home's primary action: describe a task, pick the agent to run it, send.
 *
 * The picker rides the composer's prefix (left), leaving the send button where it always is —
 * the send affordance is the one the rest of the app teaches, and a bespoke "Start" button
 * beside it would be a second way to do the same thing.
 *
 * This composer does exactly ONE thing: run a task with an agent that exists. Creating an agent
 * is its own surface; it used to sit in this picker as a mode, which meant the only entry point
 * to creating an agent was hidden inside a dropdown, and send did two different things depending
 * on a selection you couldn't see.
 */
export const HomeTaskComposer = ({
    agents,
    attachments,
    onStart,
    onStartError,
    extraPrefix,
    fixedAgentId,
    placeholder = "Describe the task, or start the conversation…",
}: HomeTaskComposerProps) => {
    const [agentId, setAgentId] = useState<string | null>(null)

    // Default to the most recently touched agent — the one you're most likely to want next.
    // A pick only counts while it is still in the list: an agent deleted (or filtered out) under
    // the composer otherwise left the trigger blank and sent the task to an agent that is gone.
    const picked = agentId && agents.some((agent) => agent.id === agentId) ? agentId : null
    const effectiveAgentId = fixedAgentId ?? picked ?? agents[0]?.id ?? null
    const selectedName = useMemo(
        () => agents.find((agent) => agent.id === effectiveAgentId)?.name,
        [agents, effectiveAgentId],
    )

    return (
        <ChatComposer
            onSubmit={async (text) => {
                if (!effectiveAgentId) return
                try {
                    await onStart({agentId: effectiveAgentId, text})
                } catch (error) {
                    // `ChatComposer.onSubmit` is fire-and-forget, so a rejecting host would
                    // surface as an unhandled rejection and nothing else.
                    onStartError?.(error)
                }
            }}
            attachments={attachments}
            placeholder={placeholder}
            disabled={!effectiveAgentId}
            extraPrefix={
                fixedAgentId ? (
                    extraPrefix
                ) : (
                    <span className="flex items-center gap-1">
                        <Select value={effectiveAgentId ?? undefined} onValueChange={setAgentId}>
                            <SelectTrigger
                                aria-label="Agent"
                                className="min-w-40 border-0 bg-transparent px-1 shadow-none"
                            >
                                <SelectValue placeholder="Select an agent">
                                    <span className="inline-flex items-center gap-1.5">
                                        <AgentGlyph
                                            workflowId={effectiveAgentId}
                                            size={14}
                                            fallback={
                                                <RobotIcon
                                                    size={14}
                                                    className="text-colorTextTertiary"
                                                />
                                            }
                                        />
                                        {selectedName}
                                    </span>
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {agents.map((agent) => (
                                    <SelectItem key={agent.id} value={agent.id}>
                                        {agent.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {extraPrefix}
                    </span>
                )
            }
        />
    )
}
