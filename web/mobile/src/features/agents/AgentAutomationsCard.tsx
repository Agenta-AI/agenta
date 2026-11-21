import {useUpcomingTriggers} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import agentsOverview from "@agenta/i18n/catalogs/agents.overview"
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
    const t = useT(agentsOverview)
    const router = useRouter()
    const {rows, isLoading, hasError, retry} = useUpcomingTriggers({agentId, agentNames})

    return (
        <AgentOverviewCard title={t("agents.overview.automationsTitle")}>
            {isLoading ? (
                <AgentOverviewCardSkeleton rows={2} />
            ) : hasError ? (
                <AgentOverviewCardError
                    message={t("agents.overview.automationsLoadError")}
                    onRetry={retry}
                />
            ) : rows.length === 0 ? (
                <p className="m-0 py-2 text-[13px] text-muted-foreground">
                    {t("agents.overview.automationsEmpty")}
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
