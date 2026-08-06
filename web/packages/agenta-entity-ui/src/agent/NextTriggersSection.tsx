import {useMemo} from "react"

import {
    describeCron,
    nextCronRuns,
    triggerBoundAgentId,
    useTriggerSchedules,
    useTriggerSubscriptions,
} from "@agenta/entities/gatewayTrigger"
import {dayjs} from "@agenta/shared/utils"
import {PanelSection} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {LightningIcon} from "@phosphor-icons/react"

import {Tip} from "./Tip"

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
 * Automations already appear on these pages as runs that HAPPENED. That answers "did it work",
 * never "is anything coming" — a schedule that silently stopped firing looks identical to one
 * that has simply not come round yet. Schedules project forward from their own cron expression;
 * event subscriptions have no next time by nature, so they say what they are instead and sort
 * after everything dated.
 */
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

export interface NextTriggersSectionProps {
    /** Scope to one agent's triggers. On that agent's own page the binding is the premise, so
     * rows drop the agent name and lead with the cadence instead. */
    agentId?: string
    /** Agent display names by workflow id. The classified agents list is app state, so the app
     * hands the names over; an unknown id reads as "Unassigned agent". */
    agentNames?: ReadonlyMap<string, string>
}

export const NextTriggersSection = ({agentId, agentNames}: NextTriggersSectionProps = {}) => {
    const {schedules, isLoading: schedulesLoading} = useTriggerSchedules()
    const {subscriptions, isLoading: subscriptionsLoading} = useTriggerSubscriptions()

    const rows = useMemo<UpcomingTrigger[]>(() => {
        const describeAgent = (references: unknown) => {
            const boundId = triggerBoundAgentId(references as never)
            return (boundId && agentNames?.get(boundId)) || "Unassigned agent"
        }
        const isInScope = (references: unknown) =>
            !agentId || triggerBoundAgentId(references as never) === agentId

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
                    // Scoped to one agent, an unnamed schedule's title already IS the cadence.
                    subtitle: agentId
                        ? schedule.name
                            ? cadence
                            : ""
                        : schedule.name
                          ? `${agent} · ${cadence}`
                          : agent,
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
                        ? subscription.name
                            ? eventKey
                            : ""
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
                <div className="flex flex-col gap-2 px-2 py-2">
                    <SkeletonBlock active className="h-4 w-3/4" />
                    <SkeletonBlock active className="h-4 w-1/2" />
                </div>
            ) : rows.length === 0 ? (
                <p className="m-0 px-2 py-3 text-xs text-colorTextTertiary">
                    {agentId
                        ? "No triggers bound to this agent yet."
                        : "Nothing scheduled. Give an agent a trigger and its next run shows up here."}
                </p>
            ) : (
                rows.map((row) => (
                    <Tip key={row.id} title={row.tooltip} side="left">
                        <div className="box-border flex items-start gap-2 rounded-lg px-2 py-2.5">
                            <LightningIcon
                                size={16}
                                className="mt-0.5 shrink-0 text-colorTextTertiary"
                                weight="fill"
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-sm text-colorText">{row.name}</span>
                                {row.subtitle ? (
                                    <span className="truncate text-[13px] text-colorTextSecondary">
                                        {row.subtitle}
                                    </span>
                                ) : null}
                            </span>
                            <span className="mt-0.5 shrink-0 text-xs text-colorTextSecondary">
                                {row.detail}
                            </span>
                        </div>
                    </Tip>
                ))
            )}
        </PanelSection>
    )
}
