import type {ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {ChatBubble} from "@agenta/ui/components/presentational"
import {type UIMessage} from "ai"

import OnboardingBrowseTemplates from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingBrowseTemplates"

import AgentChatEmptyState from "./AgentChatEmptyState"
import AgentChatHistoryUnavailable from "./AgentChatHistoryUnavailable"
import {TranscriptSkeleton} from "./AgentChatSkeleton"
import AgentMessage from "./AgentMessage"
import ConnectModelCallout from "./ConnectModelCallout"
import MessageRow from "./MessageRow"

/**
 * What the transcript shows with no messages yet. Five mutually-exclusive states, in priority
 * order: an optimistic first turn mid-commit, the template gallery, the hydration skeleton, the
 * "history unavailable" notice, and otherwise the start-a-chat hero.
 */
const TranscriptPlaceholder = ({
    entityId,
    sessionId,
    pendingFirstTurn,
    pendingFirstMessage,
    onboardingActive,
    browseAll,
    isHydrating,
    hydratedEmpty,
    firstRunPrompt,
    showTemplateStrip,
    canStart,
    onStart,
    onPrefill,
    onRewind,
    onClientToolOutput,
}: {
    entityId: string
    sessionId: string
    pendingFirstTurn: string | null
    pendingFirstMessage: UIMessage
    onboardingActive: boolean
    browseAll?: boolean
    isHydrating: boolean
    hydratedEmpty: boolean
    firstRunPrompt: string | null
    /** The composer-docked template strip is rendering — the empty state drops its starter pills. */
    showTemplateStrip: boolean
    /** The connect-model gate is clear — a turn can actually run (`!modelBlocked`). */
    canStart: boolean
    onStart: (text: string) => void | Promise<void>
    onPrefill: (text: string) => void
    onRewind: (message: UIMessage) => void
    onClientToolOutput: ClientToolOutputHandler
}) => {
    if (pendingFirstTurn) {
        // Optimistic first turn: the submitted description as a sent user bubble + an assistant
        // loading placeholder (mirrors a real `status:"submitted"` turn), so the commit reads as
        // one continuous chat, not an empty state.
        //
        // Unless the connect-model gate is up — then the seed is parked, no run was ever dispatched,
        // and a loader would spin forever (#6441). The callout says so in the thread instead, and
        // reverts to the loader the moment a key lands and the parked seed sends itself.
        return (
            <MessageRow mid="pending-first-turn" enter>
                <AgentMessage
                    message={pendingFirstMessage}
                    sessionId={sessionId}
                    isLastMessage
                    onRewind={onRewind}
                    onClientToolOutput={onClientToolOutput}
                />
                <ChatBubble
                    placement="start"
                    variant="borderless"
                    className="min-w-0 max-w-[85%]"
                    loading={canStart}
                    content={canStart ? undefined : <ConnectModelCallout />}
                />
            </MessageRow>
        )
    }
    // "Browse all templates" swaps the hero for the full gallery IN PLACE.
    if (onboardingActive && browseAll) return <OnboardingBrowseTemplates />
    // Server-history hydration in flight — skeleton, not the "start a chat" hero, so a durable
    // session doesn't flash the empty state.
    if (isHydrating) return <TranscriptSkeleton />
    // Known session whose records hydrated empty (pruned/expired) — a soft notice, not the
    // new-chat hero. Composer below stays usable.
    if (hydratedEmpty && !onboardingActive) return <AgentChatHistoryUnavailable />
    return (
        <AgentChatEmptyState
            entityId={entityId}
            onStart={onStart}
            firstRunPrompt={firstRunPrompt}
            showTemplateStrip={showTemplateStrip}
            canStart={canStart}
            onboarding={onboardingActive}
            onPrefill={onPrefill}
        />
    )
}

export default TranscriptPlaceholder
