/**
 * DateTimePicker
 *
 * shadcn's date-and-time pattern as ONE control: a {@link DatePicker} (Calendar in a popover)
 * beside a {@link TimePicker} (hour/minute columns in a popover), sharing a single value. Call
 * sites bind one `value`/`onChange` instead of wiring two controls and re-implementing the merge.
 *
 * Each half only replaces its own component — picking a day keeps the time, and setting a time
 * keeps the day — so a window that opens at 09:30 never silently snaps to midnight. Clearing the
 * date clears the whole value.
 *
 * @example
 * ```tsx
 * <DateTimePicker value={start} onChange={setStart} placeholder="Unbounded" />
 * ```
 */
import * as React from "react"

import {dayjs} from "@agenta/shared/utils"

import {DatePicker} from "./date-picker"
import {TimePicker} from "./time-picker"
import {cn} from "./utils"

type Dayjs = ReturnType<typeof dayjs>

export interface DateTimePickerProps {
    value?: Dayjs | null
    onChange?: (value: Dayjs | undefined) => void
    /** Placeholder for the date half. */
    placeholder?: string
    disabled?: boolean
    /** Display format for the date trigger. @default "YYYY-MM-DD" */
    dateFormat?: string
    /** Time granularity in seconds, matching the native `step`. @default 300 (5 minutes) */
    step?: number
    className?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}

function DateTimePicker({
    value,
    onChange,
    placeholder,
    disabled,
    dateFormat,
    step = 300,
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}: DateTimePickerProps) {
    const uid = React.useId()
    const dateNameId = `${uid}-date`
    const timeNameId = `${uid}-time`
    const current = value && dayjs(value).isValid() ? dayjs(value) : undefined
    // A half edited before anything is set anchors to the start of today, so the other half has
    // a defined value rather than inheriting the current wall-clock.
    const base = () => current ?? dayjs().startOf("day")

    return (
        <div className={cn("flex items-center gap-2", className)}>
            {/* Both halves would otherwise announce one identical name, so a screen-reader user
                can't tell which has focus. aria-labelledby concatenates, so each half appends
                its own word to the caller's label. */}
            <span id={dateNameId} className="sr-only">
                date
            </span>
            <span id={timeNameId} className="sr-only">
                time
            </span>
            <DatePicker
                value={current}
                onChange={(next) =>
                    onChange?.(
                        next
                            ? base().year(next.year()).month(next.month()).date(next.date())
                            : undefined,
                    )
                }
                placeholder={placeholder}
                disabled={disabled}
                format={dateFormat}
                aria-label={ariaLabel ? `${ariaLabel} date` : undefined}
                aria-labelledby={ariaLabelledby ? `${ariaLabelledby} ${dateNameId}` : undefined}
                className="min-w-0 flex-1"
            />
            <TimePicker
                value={current ? current.format("HH:mm") : ""}
                onChange={(next) => {
                    const [hour, minute] = next.split(":").map(Number)
                    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return
                    onChange?.(base().hour(hour).minute(minute).second(0).millisecond(0))
                }}
                step={step}
                disabled={disabled}
                aria-label={ariaLabel ? `${ariaLabel} time` : undefined}
                aria-labelledby={ariaLabelledby ? `${ariaLabelledby} ${timeNameId}` : undefined}
                className="w-[104px] shrink-0"
            />
        </div>
    )
}

export {DateTimePicker}
