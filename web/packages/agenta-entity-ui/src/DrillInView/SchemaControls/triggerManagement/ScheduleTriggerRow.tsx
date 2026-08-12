/** One schedule row in the Triggers section: cadence subtitle + a version-drift tag. */
import {type ReactNode} from "react"

import {
    describeCron,
    isEntityActive,
    nextCronRuns,
    type TriggerSchedule,
} from "@agenta/entities/gatewayTrigger"
import {Clock} from "@phosphor-icons/react"

import {TriggerRow} from "./TriggerRow"
import {useDriftTag} from "./useDriftTag"

/** "next in 14h" — the coarse time until the next UTC fire, or null if none upcoming. */
function formatNextRun(cron?: string): string | null {
    if (!cron) return null
    const [next] = nextCronRuns(cron, 1)
    if (!next) return null
    const mins = Math.round((next.getTime() - Date.now()) / 60000)
    if (mins <= 0) return null
    if (mins < 60) return `next in ${mins}m`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `next in ${hours}h`
    return `next in ${Math.round(hours / 24)}d`
}

export function ScheduleTriggerRow({
    record,
    entityId,
    disabled,
    onOpen,
    menu,
}: {
    record: TriggerSchedule
    /** The open agent's revision id, compared against the schedule's binding target. */
    entityId: string | null
    disabled?: boolean
    onOpen: () => void
    menu: ReactNode
}) {
    const cron = record.data?.schedule
    const named = !!record.name?.trim()
    // Subtitle answers "when does this run?" — the cadence plus the next fire.
    const cadence = cron ? describeCron(cron) : "No schedule set"
    const next = formatNextRun(cron)
    const driftTag = useDriftTag(record.data?.references, entityId)

    return (
        <TriggerRow
            icon={<Clock size={15} />}
            name={named ? (record.name as string) : "Untitled schedule"}
            nameMuted={!named}
            chip={driftTag ?? undefined}
            subtitle={next ? `${cadence} · ${next}` : cadence}
            active={isEntityActive(record)}
            disabled={disabled}
            onOpen={onOpen}
            menu={menu}
        />
    )
}
