/** The schedule drawer's optional [start, end) active-window bounds. */
import {localFaceToUtcIso, utcIsoToLocalFace} from "@agenta/entities/gatewayTrigger"
import {DatePicker, Typography} from "antd"

// ---------------------------------------------------------------------------
// WindowField — optional UTC start/end bounds. [start, end): a tick fires only
// at or after start and strictly before end; either side empty = unbounded.
// Past end_time auto-stops the schedule on the next backend refresh.
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
    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-3">
                <div className="flex w-[116px] shrink-0 flex-col gap-2">
                    <span className="flex h-8 items-center px-2.5 text-xs text-[var(--ag-colorTextSecondary)]">
                        Start
                    </span>
                    <span className="flex h-8 items-center px-2.5 text-xs text-[var(--ag-colorTextSecondary)]">
                        End
                    </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                    <DatePicker
                        showTime={{format: "HH:mm"}}
                        format="YYYY-MM-DD HH:mm"
                        placeholder="Unbounded"
                        className="w-full max-w-prose"
                        value={utcIsoToLocalFace(startTime)}
                        onChange={(d) => onChangeStart(localFaceToUtcIso(d))}
                    />
                    <DatePicker
                        showTime={{format: "HH:mm"}}
                        format="YYYY-MM-DD HH:mm"
                        placeholder="Unbounded"
                        className="w-full max-w-prose"
                        value={utcIsoToLocalFace(endTime)}
                        onChange={(d) => onChangeEnd(localFaceToUtcIso(d))}
                    />
                </div>
            </div>
            <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                Schedule fires only within [start, end). Leave either empty for no bound; past end
                auto-stops it.
            </Typography.Text>
        </div>
    )
}
