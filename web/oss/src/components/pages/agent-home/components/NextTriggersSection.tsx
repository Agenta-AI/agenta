import {useMemo} from "react"

import {
    describeCron,
    nextCronRuns,
    useTriggerSchedules,
    useTriggerSubscriptions,
} from "@agenta/entities/gatewayTrigger"
import {LightningIcon} from "@phosphor-icons/react"
import {Skeleton, Tooltip} from "antd"
import dayjs from "dayjs"
import {useAtomValue} from "jotai"

import {agentsWorkflowsAtom} from "@/oss/components/pages/agents/store"
import {PanelSection} from "@/oss/components/PanelSection"

const LIST_SIZE = 5

/** `formatDay` renders in UTC; a next-run time is only meaningful in the reader's own day. */
const formatNextRun = (at: Date) => {
    const run = dayjs(at)
    const days = run.startOf("day").diff(dayjs().startOf("day"), "day")
    if (days === 0) return run.format("HH:mm")
    if (days === 1) return `tomorrow ${run.format("HH:mm")}`
    if (days < 7) return run.format("ddd HH:mm")
    return run.format("D MMM HH:mm")
}

/**
 * What is going to fire, soonest first.
 *
 * Automations already appear on this page as runs that HAPPENED. That answers "did it work",
 * never "is anything coming" — a schedule that silently stopped firing looks identical to one
 * that has simply not come round yet. Schedules project forward from their own cron expression;
 * event subscriptions have no next time by nature, so they say what they are instead and sort
 * after everything dated.
 */
/** Schedules and subscriptions both name their agent through the same reference keys. */
const boundAgentId = (
    references: Record<string, {id?: string | null} | undefined> | null | undefined,
) =>
    references?.application?.id ??
    references?.application_variant?.id ??
    references?.application_revision?.id ??
    null

interface UpcomingTrigger {
    id: string
    /** What it does. Falls back to the cadence in words, never to a cron expression. */
    name: string
    /** Which agent runs it, and how often. */
    subtitle: string
    detail: string
    /** Absent for event subscriptions — they fire when the world does. */
    at: Date | null
    tooltip: string
}

/**
 * @param agentId Scope to one agent's triggers. On that agent's own page the binding is the
 * premise, so rows drop the agent name and lead with the cadence instead.
 */
const NextTriggersSection = ({agentId}: {agentId?: string} = {}) => {
    const {schedules, isLoading: schedulesLoading} = useTriggerSchedules()
    const {subscriptions, isLoading: subscriptionsLoading} = useTriggerSubscriptions()

    const agents = useAtomValue(agentsWorkflowsAtom)
    const agentNames = useMemo(
        () => new Map(agents.map((agent) => [agent.workflowId, agent.name])),
        [agents],
    )

    const rows = useMemo<UpcomingTrigger[]>(() => {
        const describeAgent = (references: unknown) => {
            const boundId = boundAgentId(references as never)
            return (boundId && agentNames.get(boundId)) || "Unassigned agent"
        }
        const isInScope = (references: unknown) =>
            !agentId || boundAgentId(references as never) === agentId

        const scheduled = schedules
            .filter(
                (schedule) =>
                    schedule.flags?.is_active !== false &&
                    !schedule.deleted_at &&
                    isInScope(schedule.data?.references),
            )
            .map((schedule, index) => {
                const expression = schedule.data?.schedule ?? ""
                const [next] = nextCronRuns(expression, 1)
                const cadence = describeCron(expression)
                const agent = describeAgent(schedule.data?.references)
                return {
                    id: schedule.id ?? `schedule-${index}`,
                    // An unnamed schedule reads as its cadence, never as "5 * * * *".
                    name: schedule.name || cadence,
                    subtitle: agentId ? cadence : schedule.name ? `${agent} · ${cadence}` : agent,
                    detail: next ? formatNextRun(next) : "—",
                    at: next ?? null,
                    tooltip: cadence,
                }
            })

        const evented = subscriptions
            .filter(
                (subscription) =>
                    subscription.flags?.is_active !== false &&
                    isInScope(subscription.data?.references),
            )
            .map((subscription, index) => {
                const eventKey = subscription.data?.event_key ?? ""
                const agent = describeAgent(subscription.data?.references)
                return {
                    id: subscription.id ?? `subscription-${index}`,
                    name: subscription.name || eventKey || "Event trigger",
                    subtitle: agentId
                        ? eventKey || "Event trigger"
                        : eventKey && subscription.name
                          ? `${agent} · ${eventKey}`
                          : agent,
                    detail: "on event",
                    at: null,
                    tooltip: eventKey ? `Fires on ${eventKey}` : "Fires when its event arrives",
                }
            })

        // Dated first and soonest-first; undated (event) triggers keep their own order after them.
        return [...scheduled, ...evented]
            .sort((a, b) => {
                if (a.at && b.at) return a.at.getTime() - b.at.getTime()
                if (a.at) return -1
                if (b.at) return 1
                return 0
            })
            .slice(0, LIST_SIZE)
    }, [schedules, subscriptions, agentNames, agentId])

    const isLoading = schedulesLoading || subscriptionsLoading

    return (
        <PanelSection title="Next triggers">
            {isLoading ? (
                <div className="px-2 py-1">
                    <Skeleton active paragraph={{rows: 2}} title={false} />
                </div>
            ) : rows.length === 0 ? (
                <p className="m-0 px-2 py-3 text-xs text-colorTextTertiary">
                    {agentId
                        ? "No triggers bound to this agent yet."
                        : "Nothing scheduled. Give an agent a trigger and its next run shows up here."}
                </p>
            ) : (
                rows.map((row) => (
                    <Tooltip key={row.id} title={row.tooltip} placement="left">
                        <div className="box-border flex items-start gap-2 rounded-lg px-2 py-2.5">
                            <LightningIcon
                                size={16}
                                className="mt-0.5 shrink-0 text-colorTextTertiary"
                                weight="fill"
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-sm text-colorText">{row.name}</span>
                                <span className="truncate text-[13px] text-colorTextSecondary">
                                    {row.subtitle}
                                </span>
                            </span>
                            <span className="mt-0.5 shrink-0 text-xs text-colorTextSecondary">
                                {row.detail}
                            </span>
                        </div>
                    </Tooltip>
                ))
            )}
        </PanelSection>
    )
}

export default NextTriggersSection
