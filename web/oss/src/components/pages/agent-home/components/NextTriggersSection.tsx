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
interface UpcomingTrigger {
    id: string
    name: string
    detail: string
    /** Absent for event subscriptions — they fire when the world does. */
    at: Date | null
    tooltip: string
}

const NextTriggersSection = () => {
    const {schedules, isLoading: schedulesLoading} = useTriggerSchedules()
    const {subscriptions, isLoading: subscriptionsLoading} = useTriggerSubscriptions()

    const rows = useMemo<UpcomingTrigger[]>(() => {
        const scheduled = schedules
            .filter((schedule) => schedule.flags?.is_active !== false && !schedule.deleted_at)
            .map((schedule, index) => {
                const expression = schedule.data?.schedule ?? ""
                const [next] = nextCronRuns(expression, 1)
                return {
                    id: schedule.id ?? `schedule-${index}`,
                    name: schedule.name || describeCron(expression) || "Schedule",
                    detail: next ? formatNextRun(next) : "—",
                    at: next ?? null,
                    tooltip: describeCron(expression) || expression,
                }
            })

        const evented = subscriptions
            .filter((subscription) => subscription.flags?.is_active !== false)
            .map((subscription, index) => ({
                id: subscription.id ?? `subscription-${index}`,
                name: subscription.name || subscription.data?.event_key || "Event trigger",
                detail: "on event",
                at: null,
                tooltip: "Fires when its event arrives",
            }))

        // Dated first and soonest-first; undated (event) triggers keep their own order after them.
        return [...scheduled, ...evented]
            .sort((a, b) => {
                if (a.at && b.at) return a.at.getTime() - b.at.getTime()
                if (a.at) return -1
                if (b.at) return 1
                return 0
            })
            .slice(0, LIST_SIZE)
    }, [schedules, subscriptions])

    const isLoading = schedulesLoading || subscriptionsLoading

    return (
        <PanelSection title="Next triggers">
            {isLoading ? (
                <div className="px-2 py-1">
                    <Skeleton active paragraph={{rows: 2}} title={false} />
                </div>
            ) : rows.length === 0 ? (
                <p className="m-0 px-2 py-3 text-xs text-colorTextTertiary">
                    Nothing scheduled. Give an agent a trigger and its next run shows up here.
                </p>
            ) : (
                rows.map((row) => (
                    <Tooltip key={row.id} title={row.tooltip} placement="left">
                        <div className="box-border flex items-center gap-2 rounded-lg px-2 py-2.5">
                            <LightningIcon
                                size={16}
                                className="shrink-0 text-colorTextTertiary"
                                weight="fill"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-colorText">
                                {row.name}
                            </span>
                            <span className="shrink-0 text-xs text-colorTextSecondary">
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
