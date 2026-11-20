import {useT} from "@agenta/i18n"
import agentsActivity from "@agenta/i18n/catalogs/agents.activity"
import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {MessagesSquare, Zap} from "lucide-react"

import type {AgentActivityTab} from "../agentActivityView"

const COPY = {
    sessions: {
        title: "agents.activity.emptySessionsTitle",
        body: "agents.activity.emptySessionsBody",
    },
    runs: {title: "agents.activity.emptyRunsTitle", body: "agents.activity.emptyRunsBody"},
} as const

/** The tab's list has nothing in it — under a header row that is still true, so no frame of its own. */
export const AgentActivityEmpty = ({tab}: {tab: AgentActivityTab}) => {
    const t = useT(agentsActivity)
    const copy = COPY[tab]
    return (
        <Empty className="py-12">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    {tab === "runs" ? <Zap /> : <MessagesSquare />}
                </EmptyMedia>
                <EmptyTitle>{t(copy.title)}</EmptyTitle>
                <EmptyDescription>{t(copy.body)}</EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}
