import {useCallback, useEffect} from "react"

import {RichChatInput} from "@agenta/ui/rich-chat-input"
import {useSetAtom} from "jotai"

import {useStartAgentSession} from "@/oss/components/AgentChatSlice/hooks/useStartAgentSession"
import NextTriggersSection from "@/oss/components/pages/agent-home/components/NextTriggersSection"
import UsageSummary from "@/oss/components/pages/agent-home/components/UsageSummary"
import SessionListCard from "@/oss/components/pages/sessions/components/SessionListCard"
import {PanelScroll, PanelSurface} from "@/oss/components/PanelSection"
import useURL from "@/oss/hooks/useURL"
import {layoutFullHeightRequestAtom} from "@/oss/state/layout/fullHeight"

import AgentConfigurationCard from "./AgentConfigurationCard"
import AgentFilesCard from "./AgentFilesCard"

interface Props {
    appId: string
    /** Used only in the composer's placeholder, so a null name degrades to a generic prompt. */
    agentName?: string
}

/**
 * An agent's overview: activity in the main column, identity in the rail.
 *
 * The page it replaces led with four full-page charts, so a freshly created agent's overview was
 * four empty rectangles and no way to see what the agent even was. Metrics move into the rail's
 * usage strip, which expands to the same dashboard for anyone who came for them.
 *
 * Configuration sits in the rail rather than under the composer because it is reference material:
 * it answers a first visit, while "what happened / what needs me" answers every visit after. With
 * it in the main column a waiting session sat below six rows of settings. The rail is also the
 * width the config rows were designed for — they come from the playground's panel, which is narrow.
 *
 * Columns scroll independently, as Home's do. They did not when this page held one list; with
 * Sessions and Automation runs both in the main column it outgrew the rail, and a whole-page
 * scroll meant losing the configuration while reading the sessions. The full-height frame is
 * requested rather than matched on the path, because this route also serves the prompt and
 * evaluator overviews, which still flow.
 */
const AgentOverview = ({appId, agentName}: Props) => {
    const startSession = useStartAgentSession()
    // The layout can't tell an agent overview from a prompt one by its path, so this branch asks
    // for the bounded frame and releases it on the way out.
    const requestFullHeight = useSetAtom(layoutFullHeightRequestAtom)
    useEffect(() => {
        requestFullHeight(true)
        return () => requestFullHeight(false)
    }, [requestFullHeight])

    // "View all" stays on this agent's rail rather than dropping you on the project list with a
    // filter you then have to trust.
    const {appURL} = useURL()
    const sessionsHref = appURL ? `${appURL}/sessions` : undefined

    const handleSubmit = useCallback(
        (markdown: string) => {
            if (markdown.trim()) startSession({appId, message: markdown})
        },
        [appId, startSession],
    )

    return (
        // Below `lg` the columns stack and the page itself scrolls; at `lg` each column takes the
        // frame's height and scrolls on its own, so reading a long session list never carries the
        // configuration rail off screen with it.
        <div className="flex min-h-0 w-full flex-1 flex-col items-start gap-6 overflow-y-auto lg:flex-row lg:overflow-hidden">
            <div className="flex w-full min-w-0 flex-col gap-6 lg:h-full lg:flex-1 lg:overflow-y-auto lg:pr-1">
                <RichChatInput
                    // The column scrolls, so every child of it is shrinkable by default and this
                    // one collapsed to a hairline under the title once the lists overflowed.
                    className="shrink-0"
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

                {/* Bare, on the page background — the rail opposite is the page's one defined
                    object, and two sheets facing each other read as equal weight. */}
                <div className="flex flex-col gap-10">
                    <SessionListCard
                        withPinned
                        agentId={appId}
                        // Same sensible limit Home settles on; the rest reveal in place.
                        limit={6}
                        title="Sessions"
                        emptyText="Conversations with this agent will show up here."
                        viewAllHref={sessionsHref}
                    />

                    {/* Co-equal with Sessions, not a filter of it: an automation run is one the
                        user configured but did not start. A toggle would hide one of the two
                        behind a click, which ranks them. */}
                    <SessionListCard
                        agentId={appId}
                        origin="trigger"
                        title="Automation runs"
                        emptyText="Runs from automations bound to this agent will show up here."
                        limit={5}
                        minHeightClassName="min-h-[100px]"
                        viewAllHref={sessionsHref}
                    />
                </div>
            </div>

            <div className="flex min-h-0 w-full shrink-0 grow-0 flex-col lg:h-full lg:w-1/3 lg:min-w-[340px] lg:max-w-[520px] lg:pr-1">
                <PanelSurface className="flex max-h-full min-h-0 flex-col">
                    <PanelScroll>
                        <AgentConfigurationCard appId={appId} />

                        <AgentFilesCard appId={appId} />

                        {/* Scoped to this agent. Automation RUNS below say what already happened;
                            an agent whose schedule quietly stopped looks identical there. */}
                        <NextTriggersSection agentId={appId} />

                        <UsageSummary variant="strip" />
                    </PanelScroll>
                </PanelSurface>
            </div>
        </div>
    )
}

export default AgentOverview
