/** One schedule row in the Triggers section: name + cadence subtitle. */
import {useEffect, useMemo, useState, type ReactNode} from "react"

import {
    cronToBuilder,
    describeCron,
    isEntityActive,
    nextCronRuns,
    summarizeSchedule,
    type TriggerSchedule,
} from "@agenta/entities/gatewayTrigger"
import {createT, useT} from "@agenta/i18n"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {Clock} from "@phosphor-icons/react"

import {scheduleTextNow} from "../../../gatewayTrigger/scheduleText"

import {RowTile} from "./rowParts"
import {TriggerRow} from "./TriggerRow"

const tNow = createT(triggersCatalog)

/** "next in 14h" — the coarse time until the next UTC fire, or null if none upcoming. */
function formatCountdown(cron?: string): string | null {
    if (!cron) return null
    const [next] = nextCronRuns(cron, 1)
    if (!next) return null
    const mins = Math.floor((next.getTime() - Date.now()) / 60000)
    if (mins <= 0) return null
    if (mins < 60) return tNow("entityUi.triggers.nextInMinutes", {value: mins})
    // Floor, not round: 90 minutes is "next in 1h", never "2h" — the value must not overstate.
    const hours = Math.floor(mins / 60)
    if (hours < 24) return tNow("entityUi.triggers.nextInHours", {value: hours})
    return tNow("entityUi.triggers.nextInDays", {value: Math.floor(hours / 24)})
}

export function ScheduleTriggerRow({
    record,
    disabled,
    onOpen,
    menu,
    phone,
    onToggle,
}: {
    record: TriggerSchedule
    disabled?: boolean
    onOpen: () => void
    menu: ReactNode
    /** The phone shape of the row (M10). */
    phone?: boolean
    /** Phone only: the row's switch. */
    onToggle?: (next: boolean) => void
}) {
    const t = useT(triggersCatalog)
    const cron = record.data?.schedule
    const named = !!record.name?.trim()
    // Subtitle answers "when does this run?" — the cadence plus the next fire. Both parse the
    // cron, so memoize on it; the countdown bucket needn't track unrelated re-renders.
    // The builder's words first ("Weekdays at 09:00 UTC"), as the automation view says it; the
    // longhand only for an expression the builder cannot show.
    const cadence = useMemo(
        () => {
            if (!cron) return tNow("entityUi.triggers.noScheduleSet")
            const {state, representable} = cronToBuilder(cron)
            return representable
                ? summarizeSchedule(state, scheduleTextNow())
                : describeCron(cron, scheduleTextNow())
        },
        // `t` re-words the cadence when the language changes.
        [cron, t],
    )
    // The section stays mounted for long sessions, so a mount-time countdown goes stale and can
    // claim a run is upcoming after it already fired. One coarse tick per minute keeps it honest.
    const [tick, setTick] = useState(0)
    useEffect(() => {
        if (!cron) return undefined
        const id = setInterval(() => setTick((count) => count + 1), 60_000)
        return () => clearInterval(id)
    }, [cron])
    const next = useMemo(() => formatCountdown(cron), [cron, tick])

    return (
        <TriggerRow
            // The canvas violet has no token yet; the info ink is the nearest one.
            tile={
                <RowTile className="bg-[var(--ag-colorInfo)]">
                    <Clock />
                </RowTile>
            }
            name={named ? (record.name as string) : t("entityUi.triggers.untitledSchedule")}
            nameMuted={!named}
            subtitle={next ? `${cadence} · ${next}` : cadence}
            active={isEntityActive(record)}
            disabled={disabled}
            onOpen={onOpen}
            menu={menu}
            phone={phone}
            onToggle={onToggle}
        />
    )
}
