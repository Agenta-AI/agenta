import {useCallback} from "react"

import {RichChatInput} from "@agenta/ui/rich-chat-input"

import {useStartAgentSession} from "@/oss/components/AgentChatSlice/hooks/useStartAgentSession"
import UsageSummary from "@/oss/components/pages/agent-home/components/UsageSummary"
import SessionListCard from "@/oss/components/pages/sessions/components/SessionListCard"

interface Props {
    appId: string
    /** Used only in the composer's placeholder, so a null name degrades to a generic prompt. */
    agentName?: string
}

/**
 * An agent's overview: what it is, what it has been doing, and how it is performing — in that
 * order of prominence.
 *
 * The page it replaces led with four full-page charts, so a freshly created agent's overview was
 * four empty rectangles and no way to see what the agent even was. Metrics move into the rail's
 * usage strip, which expands to the same dashboard for anyone who came for them.
 *
 * Columns here do NOT scroll independently the way Home's do: every card is bounded (a capped
 * session list, a collapsed usage strip), so there is nothing to trap. Inventing a scroll
 * container for content that fits would also mean claiming the layout's full-height frame, which
 * this route shares with evaluator and prompt overviews that genuinely do flow.
 */
const AgentOverview = ({appId, agentName}: Props) => {
    const startSession = useStartAgentSession()

    const handleSubmit = useCallback(
        (markdown: string) => {
            if (markdown.trim()) startSession({appId, message: markdown})
        },
        [appId, startSession],
    )

    return (
        <div className="flex w-full flex-col items-start gap-6 lg:flex-row">
            <div className="flex w-full min-w-0 flex-col gap-6 lg:flex-1">
                <RichChatInput
                    onSubmit={handleSubmit}
                    size="comfortable"
                    minHeightClassName="min-h-20"
                    textSizeClassName="text-sm"
                    placeholder={
                        agentName
                            ? `Ask ${agentName}… — starts a new session`
                            : "Describe a task — starts a new session"
                    }
                />

                <SessionListCard
                    withPinned
                    agentId={appId}
                    limit={8}
                    title="Sessions"
                    emptyText="Conversations with this agent will show up here."
                />
            </div>

            <div className="flex w-full shrink-0 grow-0 flex-col gap-6 lg:w-1/3 lg:min-w-[340px] lg:max-w-[520px]">
                <SessionListCard
                    agentId={appId}
                    origin="trigger"
                    title="Automation runs"
                    emptyText="Runs from automations bound to this agent will show up here."
                    limit={5}
                    minHeightClassName="min-h-[100px]"
                />
                <UsageSummary variant="strip" />
            </div>
        </div>
    )
}

export default AgentOverview
