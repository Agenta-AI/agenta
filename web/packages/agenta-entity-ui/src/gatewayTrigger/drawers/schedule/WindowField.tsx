/** The schedule drawer's optional [start, end) active-window bounds. */
import {useId} from "react"

import {localFaceToUtcIso, utcIsoToLocalFace} from "@agenta/entities/gatewayTrigger"

import {DateTimeInput} from "../../../gatewayTool/components/schemaFormControls"

// ---------------------------------------------------------------------------
// WindowField — optional UTC start/end bounds. [start, end): a tick fires only
// at or after start and strictly before end; either side empty = unbounded.
// Past end_time auto-stops the schedule on the next backend refresh.
//
// The antd DatePicker (calendar + time column) has no @agenta/ui primitive; the
// shared DateTimeInput (native `datetime-local` on the Input primitive) replaces
// it. Deviation: a native datetime-local shows the browser's empty-value template
// rather than the "Unbounded" placeholder — the hint line below carries that.
// ---------------------------------------------------------------------------

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
    // Names each native date input from its visible Start/End label (axe label rule).
    const startLabelId = useId()
    const endLabelId = useId()
    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-3">
                <div className="flex w-[116px] shrink-0 flex-col gap-2">
                    <span
                        id={startLabelId}
                        className="flex h-8 items-center px-2.5 text-xs text-[var(--ag-colorTextSecondary)]"
                    >
                        Start
                    </span>
                    <span
                        id={endLabelId}
                        className="flex h-8 items-center px-2.5 text-xs text-[var(--ag-colorTextSecondary)]"
                    >
                        End
                    </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                    <div className="w-full max-w-prose">
                        <DateTimeInput
                            showTime
                            aria-labelledby={startLabelId}
                            value={utcIsoToLocalFace(startTime) ?? undefined}
                            onChange={(d) => onChangeStart(localFaceToUtcIso(d ?? null))}
                        />
                    </div>
                    <div className="w-full max-w-prose">
                        <DateTimeInput
                            showTime
                            aria-labelledby={endLabelId}
                            value={utcIsoToLocalFace(endTime) ?? undefined}
                            onChange={(d) => onChangeEnd(localFaceToUtcIso(d ?? null))}
                        />
                    </div>
                </div>
            </div>
            <span className="text-[11px] leading-snug text-[var(--ag-colorTextDescription)]">
                Schedule fires only within [start, end). Leave either empty for no bound; past end
                auto-stops it.
            </span>
        </div>
    )
}
