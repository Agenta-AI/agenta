import {useUpcomingTriggers} from "@agenta/entity-ui/agent"
import {Clock, Lightning} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {AgentOverviewCard} from "./AgentOverviewCard"
import {AgentOverviewCardRow} from "./AgentOverviewCardRow"
import {AgentOverviewCardError} from "./states/AgentOverviewCardError"
import {AgentOverviewCardSkeleton} from "./states/AgentOverviewCardSkeleton"

const ICON = 16

/**
 * What is going to run, soonest first — the agent's schedules and event subscriptions. Runs that
 * HAPPENED are in the activity list; this answers "is anything coming".
 */
export const AgentAutomationsCard = ({
    agentId,
    agentNames,
    base,
}: {
    agentId: string
    agentNames?: ReadonlyMap<string, string>
    /** `/w/:workspace/p/:project` — a row opens its automation's screen. */
    base: string
}) => {
    const router = useRouter()
    const {rows, isLoading, hasError, retry} = useUpcomingTriggers({agentId, agentNames})

    return (
        <AgentOverviewCard title="Automations">
            {isLoading ? (
                <AgentOverviewCardSkeleton rows={2} />
            ) : hasError ? (
                <AgentOverviewCardError message="Couldn't load automations." onRetry={retry} />
            ) : rows.length === 0 ? (
                <p className="m-0 py-2 text-[13px] text-muted-foreground">
                    No automations bound to this agent yet.
                </p>
            ) : (
                rows.map((row) => (
                    <AgentOverviewCardRow
                        key={row.id}
                        // A clock for a schedule, a bolt for an event: the two kinds of trigger.
                        icon={
                            row.kind === "schedule" ? (
                                <Clock size={ICON} />
                            ) : (
                                <Lightning size={ICON} weight="fill" />
                            )
                        }
                        label={row.name}
                        detail={row.detail}
                        title={row.tooltip}
                        onClick={() => void router.push(`${base}/automations/${row.id}`)}
                        className="text-[13.5px]"
                    />
                ))
            )}
        </AgentOverviewCard>
    )
}
