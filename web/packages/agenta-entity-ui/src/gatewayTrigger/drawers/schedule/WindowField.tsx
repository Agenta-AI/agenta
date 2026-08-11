/** The schedule drawer's optional [start, end) active-window bounds. */
import {useId} from "react"

import {localFaceToUtcIso, utcIsoToLocalFace} from "@agenta/entities/gatewayTrigger"
import {DateTimePicker} from "@agenta/ui/ui"

// ---------------------------------------------------------------------------
// WindowField — optional UTC start/end bounds. [start, end): the schedule runs only at or after
// start and strictly before end; either side empty = unbounded. Past end_time auto-stops the
// schedule on the next backend refresh.
//
// Each bound is one `DateTimePicker`, which owns the date/time merge. This field only maps the
// stored UTC instant onto the same local clock face and back, so the user picks the UTC
// wall-clock directly (a schedule's cron is UTC).
// ---------------------------------------------------------------------------

function Row({
    label,
    placeholder,
    value,
    onChange,
}: {
    label: string
    /** Says what leaving this bound empty means, not just that it is empty. */
    placeholder: string
    value: string | null
    onChange: (next: string | null) => void
}) {
    // Names both halves of the picker from the visible row label (axe label rule).
    const labelId = useId()
    return (
        <div className="flex items-center gap-3">
            <span
                id={labelId}
                className="w-[86px] shrink-0 text-xs text-[var(--ag-colorTextDescription)]"
            >
                {label}
            </span>
            <DateTimePicker
                value={utcIsoToLocalFace(value)}
                onChange={(next) => onChange(localFaceToUtcIso(next ?? null))}
                placeholder={placeholder}
                aria-labelledby={labelId}
                className="min-w-0 flex-1"
            />
        </div>
    )
}

export function WindowField({
    startTime,
    endTime,
    onChangeStart,
    onChangeEnd,
}: {
    startTime: string | null
    endTime: string | null
    onChangeStart: (next: string | null) => void
    onChangeEnd: (next: string | null) => void
}) {
    return (
        <div className="flex flex-col gap-2">
            <Row
                label="Start"
                placeholder="Starts right away"
                value={startTime}
                onChange={onChangeStart}
            />
            <Row label="End" placeholder="Never ends" value={endTime} onChange={onChangeEnd} />
            <span className="text-xs leading-snug text-[var(--ag-colorTextDescription)]">
                Runs only within [start, end), in UTC. Leave either empty for no bound; a past end
                stops the schedule.
            </span>
        </div>
    )
}
