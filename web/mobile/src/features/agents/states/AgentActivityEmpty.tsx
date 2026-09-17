import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {MessagesSquare, Zap} from "lucide-react"

import type {AgentActivityTab} from "../agentActivityView"

const COPY: Record<AgentActivityTab, {title: string; body: string}> = {
    sessions: {
        title: "No sessions yet",
        body: "Conversations with this agent will show up here. Start one from the composer above.",
    },
    runs: {
        title: "No automation runs yet",
        body: "Runs from automations bound to this agent will show up here.",
    },
}

/** The tab's list has nothing in it — under a header row that is still true, so no frame of its own. */
export const AgentActivityEmpty = ({tab}: {tab: AgentActivityTab}) => {
    const copy = COPY[tab]
    return (
        <Empty className="py-12">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    {tab === "runs" ? <Zap /> : <MessagesSquare />}
                </EmptyMedia>
                <EmptyTitle>{copy.title}</EmptyTitle>
                <EmptyDescription>{copy.body}</EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}
