import {useCallback, useMemo} from "react"

import {
    describeCron,
    nextCronRuns,
    triggerBoundAgentId,
    useTriggerSchedules,
    useTriggerSubscriptions,
} from "@agenta/entities/gatewayTrigger"
import {nowTickAtom} from "@agenta/shared/state"
import {dayjs} from "@agenta/shared/utils"
import {useAtomValue} from "jotai"

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
export interface UpcomingTrigger {
    id: string
    /** A schedule or an event subscription — the mark a row leads with. */
    kind: "schedule" | "event"
    /** What it does. Falls back to the cadence in words, never to a cron expression. */
    name: string
    /** Which agent runs it, and how often. */
    subtitle: string
    detail: string
    /** Absent for event subscriptions — they fire when the world does. */
    at: Date | null
    tooltip: string
}

export interface UseUpcomingTriggersArgs {
    /** Scope to one agent's triggers. On that agent's own page the binding is the premise, so
     * rows drop the agent name and lead with the cadence instead. */
    agentId?: string
    /** Agent display names by workflow id. The classified agents list is app state, so the app
     * hands the names over; an unknown id reads as "Unassigned agent". */
    agentNames?: ReadonlyMap<string, string>
}

/**
 * The rows behind the Automations rail card — derived once here so the desktop panel and a host
 * with its own card chrome list the same triggers in the same order.
 */
export const useUpcomingTriggers = ({agentId, agentNames}: UseUpcomingTriggersArgs = {}) => {
    const {
        schedules,
        isLoading: schedulesLoading,
        error: schedulesError,
        refetch: refetchSchedules,
    } = useTriggerSchedules()
    const {
        subscriptions,
        isLoading: subscriptionsLoading,
        error: subscriptionsError,
        refetch: refetchSubscriptions,
    } = useTriggerSubscriptions()
    // The shared minute clock: a projected next-run time that never re-computes freezes and ends
    // up in the past.
    const nowTick = useAtomValue(nowTickAtom)

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
            .map((schedule, index): UpcomingTrigger => {
                const expression = schedule.data?.schedule ?? ""
                const [next] = nextCronRuns(expression, 1)
                const cadence = describeCron(expression)
                const agent = describeAgent(schedule.data?.references)
                return {
                    id: schedule.id ?? `schedule-${index}`,
                    kind: "schedule",
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
            .map((subscription, index): UpcomingTrigger => {
                const eventKey = subscription.data?.event_key ?? ""
                const agent = describeAgent(subscription.data?.references)
                return {
                    id: subscription.id ?? `subscription-${index}`,
                    kind: "event",
                    name: subscription.name || eventKey || "Event automation",
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
        // nowTick is a dep on purpose: it is what re-projects the next runs each minute.
    }, [schedules, subscriptions, agentNames, agentId, nowTick])

    const isLoading = schedulesLoading || subscriptionsLoading
    const hasError = Boolean(schedulesError || subscriptionsError)
    const retry = useCallback(() => {
        if (schedulesError) void refetchSchedules()
        if (subscriptionsError) void refetchSubscriptions()
    }, [schedulesError, subscriptionsError, refetchSchedules, refetchSubscriptions])

    return {rows, isLoading, hasError, retry}
}
