/** One schedule row in the Triggers section: cadence subtitle + a version-drift tag. */
import {useEffect, useMemo, useState, type ReactNode} from "react"

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
function formatCountdown(cron?: string): string | null {
    if (!cron) return null
    const [next] = nextCronRuns(cron, 1)
    if (!next) return null
    const mins = Math.floor((next.getTime() - Date.now()) / 60000)
    if (mins <= 0) return null
    if (mins < 60) return `next in ${mins}m`
    // Floor, not round: 90 minutes is "next in 1h", never "2h" — the value must not overstate.
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `next in ${hours}h`
    return `next in ${Math.floor(hours / 24)}d`
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
    // Subtitle answers "when does this run?" — the cadence plus the next fire. Both parse the
    // cron, so memoize on it; the countdown bucket needn't track unrelated re-renders.
    const cadence = useMemo(() => (cron ? describeCron(cron) : "No schedule set"), [cron])
    // The section stays mounted for long sessions, so a mount-time countdown goes stale and can
    // claim a run is upcoming after it already fired. One coarse tick per minute keeps it honest.
    const [tick, setTick] = useState(0)
    useEffect(() => {
        if (!cron) return undefined
        const id = setInterval(() => setTick((t) => t + 1), 60_000)
        return () => clearInterval(id)
    }, [cron])
    const next = useMemo(() => formatCountdown(cron), [cron, tick])
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
