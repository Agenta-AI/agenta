import {ChatCircleDots, Lightning} from "@phosphor-icons/react"

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
        <div className="flex flex-col items-center justify-center gap-2.5 px-8 py-12 text-center">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
                {tab === "runs" ? (
                    <Lightning aria-hidden size={19} />
                ) : (
                    <ChatCircleDots aria-hidden size={19} />
                )}
            </span>
            <p className="m-0 text-[14px] font-medium text-foreground">{copy.title}</p>
            <p className="m-0 max-w-[42ch] text-[13px] leading-snug text-muted-foreground">
                {copy.body}
            </p>
        </div>
    )
}
