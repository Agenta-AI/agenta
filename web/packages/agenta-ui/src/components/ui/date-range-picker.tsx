import * as React from "react"

import {dayjs} from "@agenta/shared/utils/dateTime"
import {CalendarBlank, X} from "@phosphor-icons/react"
import {ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight} from "lucide-react"

import {Button} from "./button"
import {inputVariants} from "./input"
import {Popover, PopoverAnchor, PopoverContent} from "./popover"
import {selectTriggerVariants, type SelectTriggerProps} from "./select"
import {cn} from "./utils"

/**
 * DateRangePicker — a generic, fully controlled start/end date-time range input; the
 * replacement for antd `<DatePicker>` pairs. It knows nothing about the surfaces that use it.
 *
 * DATE LIBRARY: dayjs via `@agenta/shared/utils/dateTime` (already a dependency, utc plugin
 * pre-extended) — no new dependency and no `react-day-picker`, since dayjs is the repo-wide
 * date library and the month grid is ~15 lines of it.
 *
 * WIRE FORMAT: `{startTime, endTime}` are UTC ISO strings at second precision and WITHOUT a
 * zone designator (`2024-01-31T09:00:00`) — byte-identical to what the app already sends.
 * They are parsed back as UTC and edited in the viewer's local zone, so the round-trip is
 * lossless.
 *
 * Controlled by contract: the only internal state is transient interaction state (popover
 * open, hovered day, visible month). Which end of the range the next click fills is DERIVED
 * from `value`, so it can never drift from the caller.
 *
 * antd → this:
 *   <DatePicker showTime value onChange /> ×2   → one `<DateRangePicker>`
 *   `disabledDate` min/max bounds               → `minDate` / `maxDate`
 *   allowClear                                  → `allowClear` (trigger ✕) + panel Clear
 *   size small/middle/large                     → sm/default/lg (from `selectTriggerVariants`)
 * Embedding inside another popover/panel: use `DateRangeCalendar` (no trigger, no portal).
 */
export interface DateRangeValue {
    /** UTC ISO, second precision, no zone designator. */
    startTime?: string
    /** UTC ISO, second precision, no zone designator. */
    endTime?: string
}

type DayjsValue = ReturnType<typeof dayjs>

const WIRE_FORMAT = "YYYY-MM-DDTHH:mm:ss"
const DISPLAY_FORMAT = "HH:mm:ss DD MMM YYYY"
const EMPTY_RANGE: DateRangeValue = {}
/** 6 weeks — the maximum a Gregorian month can span, so the grid never changes height. */
const GRID_CELLS = 42

/** Wire string → local-zone Dayjs for display/editing. */
function fromWire(iso?: string): DayjsValue | null {
    if (!iso) return null
    const parsed = dayjs.utc(iso)
    return parsed.isValid() ? parsed.local() : null
}

function toWire(date: DayjsValue): string {
    return date.utc().format(WIRE_FORMAT)
}

/** The clicked day, carrying `reference`'s time-of-day when there is one. */
function withTimeOf(day: DayjsValue, reference: DayjsValue | null, side: "start" | "end") {
    if (!reference) return side === "start" ? day.startOf("day") : day.endOf("day").millisecond(0)
    return day.hour(reference.hour()).minute(reference.minute()).second(reference.second())
}

function buildMonthGrid(month: DayjsValue, weekStartsOn: number): DayjsValue[] {
    const first = month.startOf("month")
    const lead = (first.day() - weekStartsOn + 7) % 7
    const gridStart = first.subtract(lead, "day")
    return Array.from({length: GRID_CELLS}, (_, index) => gridStart.add(index, "day"))
}

export interface DateRangeCalendarProps {
    value?: DateRangeValue
    onChange?: (value: DateRangeValue) => void
    /** Lower bound, same wire format as `value`. Earlier days are not selectable. */
    minDate?: string
    /** Upper bound, same wire format as `value`. Later days are not selectable. */
    maxDate?: string
    /** Show the HH:mm:ss inputs under the grid. @default true */
    showTime?: boolean
    /** Months rendered side by side. @default 2 */
    months?: 1 | 2
    /** 0 = Sunday. @default 0 */
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    /** Drop the built-in Clear footer (a host that supplies its own actions row). */
    hideClear?: boolean
    className?: string
}

/** The panel on its own — no trigger, no portal. Use it when embedding in an existing overlay. */
export function DateRangeCalendar({
    value = EMPTY_RANGE,
    onChange,
    minDate,
    maxDate,
    showTime = true,
    months = 2,
    weekStartsOn = 0,
    hideClear = false,
    className,
}: DateRangeCalendarProps) {
    const start = React.useMemo(() => fromWire(value.startTime), [value.startTime])
    const end = React.useMemo(() => fromWire(value.endTime), [value.endTime])
    const min = React.useMemo(() => fromWire(minDate), [minDate])
    const max = React.useMemo(() => fromWire(maxDate), [maxDate])

    const [viewMonth, setViewMonth] = React.useState<DayjsValue>(() =>
        (start ?? end ?? dayjs()).startOf("month"),
    )
    const [hovered, setHovered] = React.useState<DayjsValue | null>(null)

    const rid = React.useId()
    // Awaiting the closing click of a range — derived, never stored.
    const awaitingEnd = Boolean(start) && !end

    const isDisabledDay = React.useCallback(
        (day: DayjsValue) =>
            (min ? day.isBefore(min, "day") : false) || (max ? day.isAfter(max, "day") : false),
        [min, max],
    )

    const emit = React.useCallback(
        (next: DateRangeValue) => {
            onChange?.(next)
        },
        [onChange],
    )

    const selectDay = React.useCallback(
        (day: DayjsValue) => {
            if (isDisabledDay(day)) return

            if (start && !end) {
                const candidate = withTimeOf(day, null, "end")
                // Clicking before the anchor restarts the range there rather than inverting it.
                if (candidate.isBefore(start)) {
                    emit({startTime: toWire(withTimeOf(day, start, "start"))})
                } else {
                    emit({startTime: value.startTime, endTime: toWire(candidate)})
                }
                return
            }

            if (!start && end) {
                const candidate = withTimeOf(day, null, "start")
                emit(
                    candidate.isAfter(end)
                        ? {startTime: toWire(candidate)}
                        : {startTime: toWire(candidate), endTime: value.endTime},
                )
                return
            }

            emit({startTime: toWire(withTimeOf(day, start, "start"))})
        },
        [isDisabledDay, start, end, value.startTime, value.endTime, emit],
    )

    const setTime = React.useCallback(
        (side: "start" | "end", raw: string) => {
            const anchor = side === "start" ? start : end
            if (!anchor || !raw) return
            const [hour, minute, second] = raw.split(":").map((part) => Number(part) || 0)
            const next = anchor
                .hour(hour ?? 0)
                .minute(minute ?? 0)
                .second(second ?? 0)
            emit(
                side === "start"
                    ? {...value, startTime: toWire(next)}
                    : {...value, endTime: toWire(next)},
            )
        },
        [start, end, value, emit],
    )

    // The end the range is previewed against while the closing click is still pending.
    const previewEnd = awaitingEnd && hovered && !hovered.isBefore(start) ? hovered : end
    const rangeStart = start
    const rangeEnd = previewEnd

    const weekdayLabels = React.useMemo(
        () =>
            Array.from({length: 7}, (_, index) =>
                dayjs()
                    .day((weekStartsOn + index) % 7)
                    .format("dd"),
            ),
        [weekStartsOn],
    )

    const renderMonth = (offset: number) => {
        const month = viewMonth.add(offset, "month")
        const days = buildMonthGrid(month, weekStartsOn)
        return (
            <div key={offset} className="flex flex-col gap-1">
                <div className="flex h-control items-center justify-between gap-1">
                    <span className="flex items-center gap-0.5">
                        {offset === 0 ? (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Previous year"
                                    onClick={() => setViewMonth((m) => m.subtract(1, "year"))}
                                >
                                    <ChevronsLeft className="size-3" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Previous month"
                                    onClick={() => setViewMonth((m) => m.subtract(1, "month"))}
                                >
                                    <ChevronLeft className="size-3" />
                                </Button>
                            </>
                        ) : null}
                    </span>
                    <span className="text-field-md font-medium text-foreground">
                        {month.format("MMMM YYYY")}
                    </span>
                    <span className="flex items-center gap-0.5">
                        {offset === months - 1 ? (
                            <>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Next month"
                                    onClick={() => setViewMonth((m) => m.add(1, "month"))}
                                >
                                    <ChevronRight className="size-3" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Next year"
                                    onClick={() => setViewMonth((m) => m.add(1, "year"))}
                                >
                                    <ChevronsRight className="size-3" />
                                </Button>
                            </>
                        ) : null}
                    </span>
                </div>

                <div role="grid" aria-label={month.format("MMMM YYYY")} className="flex flex-col">
                    <div role="row" className="grid grid-cols-7">
                        {weekdayLabels.map((label, index) => (
                            <span
                                key={index}
                                role="columnheader"
                                className="flex h-6 items-center justify-center text-field-sm text-placeholder"
                            >
                                {label}
                            </span>
                        ))}
                    </div>
                    <div className="grid grid-cols-7">
                        {days.map((day) => {
                            const outside = !day.isSame(month, "month")
                            const disabled = isDisabledDay(day)
                            const isStart = Boolean(rangeStart && day.isSame(rangeStart, "day"))
                            const isEnd = Boolean(rangeEnd && day.isSame(rangeEnd, "day"))
                            const inRange = Boolean(
                                rangeStart &&
                                rangeEnd &&
                                !day.isBefore(rangeStart, "day") &&
                                !day.isAfter(rangeEnd, "day"),
                            )
                            const endpoint = isStart || isEnd
                            return (
                                <div
                                    key={day.valueOf()}
                                    role="gridcell"
                                    aria-selected={endpoint || undefined}
                                    className={cn(
                                        "flex items-center justify-center py-0.5",
                                        inRange && !endpoint && "bg-muted",
                                        inRange && isStart && "rounded-l-control-sm bg-muted",
                                        inRange && isEnd && "rounded-r-control-sm bg-muted",
                                    )}
                                >
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        disabled={disabled}
                                        aria-label={day.format("DD MMM YYYY")}
                                        onMouseEnter={() => setHovered(day)}
                                        onMouseLeave={() => setHovered(null)}
                                        onClick={() => selectDay(day)}
                                        className={cn(
                                            // CONTROL_RESET — see button.tsx (preflight is off app-wide).
                                            "box-border border-0 border-solid bg-transparent p-0 font-[inherit]",
                                            "flex size-6 cursor-pointer items-center justify-center rounded-control-sm text-field-sm text-foreground transition-colors",
                                            "hover:bg-secondary",
                                            outside && "text-placeholder",
                                            day.isSame(dayjs(), "day") &&
                                                !endpoint &&
                                                "border border-solid border-primary",
                                            endpoint &&
                                                "bg-primary text-primary-foreground hover:bg-btn-primary-hover",
                                            disabled &&
                                                "cursor-not-allowed bg-transparent text-disabled hover:bg-transparent",
                                        )}
                                    >
                                        {day.date()}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div data-slot="date-range-calendar" className={cn("flex flex-col gap-2 p-2", className)}>
            <div className="flex items-stretch gap-3">
                {Array.from({length: months}, (_, offset) => renderMonth(offset))}
            </div>

            {showTime ? (
                <div className="flex items-end gap-2">
                    {(["start", "end"] as const).map((side) => {
                        const anchor = side === "start" ? start : end
                        return (
                            <div key={side} className="flex flex-1 flex-col gap-1">
                                <label
                                    htmlFor={`${rid}-${side}`}
                                    className="text-field-sm text-muted-foreground"
                                >
                                    {side === "start" ? "Start time" : "End time"}
                                </label>
                                <input
                                    id={`${rid}-${side}`}
                                    type="time"
                                    step={1}
                                    disabled={!anchor}
                                    value={anchor ? anchor.format("HH:mm:ss") : ""}
                                    onChange={(event) => setTime(side, event.target.value)}
                                    className={cn(inputVariants({size: "sm"}))}
                                />
                            </div>
                        )
                    })}
                </div>
            ) : null}

            {hideClear ? null : (
                <div className="flex items-center justify-between gap-2 border-0 border-t border-solid border-border pt-2">
                    <span className="text-field-sm text-placeholder">
                        {awaitingEnd ? "Pick an end date" : "Pick a start date"}
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!start && !end}
                        onClick={() => emit({})}
                    >
                        Clear
                    </Button>
                </div>
            )}
        </div>
    )
}

export interface DateRangePickerProps
    extends DateRangeCalendarProps, Pick<SelectTriggerProps, "size" | "variant"> {
    /** dayjs format for the trigger readout. @default "HH:mm:ss DD MMM YYYY" */
    format?: string
    placeholder?: React.ReactNode
    /** Show the trigger's ✕. @default true */
    allowClear?: boolean
    disabled?: boolean
    invalid?: boolean
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    /** Portal target for the panel; defaults to document.body. */
    container?: HTMLElement | null
    contentClassName?: string
    style?: React.CSSProperties
    id?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}

export function DateRangePicker({
    value = EMPTY_RANGE,
    onChange,
    format = DISPLAY_FORMAT,
    placeholder = "Select a date range",
    allowClear = true,
    disabled = false,
    invalid = false,
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    container,
    contentClassName,
    className,
    style,
    size,
    variant,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
    ...calendarProps
}: DateRangePickerProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
    const open = openProp ?? uncontrolledOpen

    const setOpen = React.useCallback(
        (next: boolean) => {
            if (openProp === undefined) setUncontrolledOpen(next)
            onOpenChange?.(next)
        },
        [openProp, onOpenChange],
    )

    const start = fromWire(value.startTime)
    const end = fromWire(value.endTime)
    const hasValue = Boolean(start || end)

    const display = hasValue
        ? `${start ? start.format(format) : "…"} → ${end ? end.format(format) : "…"}`
        : null

    const adornmentColor = invalid ? "text-error" : "text-placeholder"
    const showClear = allowClear && hasValue && !disabled

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                {/* Div, not button: it hosts a real <button> for the clear ✕ (nested native
                    buttons are invalid), so the outer control carries the button role itself. */}
                <div
                    data-slot="date-range-picker-trigger"
                    data-placeholder={hasValue ? undefined : ""}
                    data-state={open ? "open" : "closed"}
                    id={id}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    aria-disabled={disabled || undefined}
                    aria-invalid={invalid || undefined}
                    aria-label={
                        ariaLabelledby
                            ? undefined
                            : (ariaLabel ??
                              (typeof placeholder === "string" ? placeholder : undefined))
                    }
                    aria-labelledby={ariaLabelledby}
                    style={style}
                    className={cn(
                        selectTriggerVariants({size, variant}),
                        // `group` drives the clear ✕ hover reveal (antd `.ant-picker:hover`).
                        "group",
                        // A div gets none of the variant's `disabled:` classes (they only fire on
                        // real form controls), so the disabled skin is set here — same as Cascader.
                        disabled &&
                            "pointer-events-none cursor-not-allowed border-disabled-border bg-disabled-bg text-disabled",
                        className,
                    )}
                    onClick={(event) => {
                        if ((event.target as HTMLElement).closest("[data-date-range-clear]")) return
                        setOpen(!open)
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            setOpen(!open)
                        } else if (event.key === "Escape" && open) {
                            event.preventDefault()
                            setOpen(false)
                        } else if (event.key === "Backspace" && allowClear && hasValue) {
                            onChange?.({})
                        }
                    }}
                >
                    <span
                        data-slot="date-range-picker-value"
                        className={cn(
                            "min-w-0 flex-1 truncate text-left",
                            !hasValue && "text-placeholder",
                        )}
                    >
                        {hasValue ? display : placeholder}
                    </span>
                    <span className="relative flex shrink-0 items-center">
                        <CalendarBlank
                            className={cn(
                                "size-3 shrink-0 transition-opacity",
                                showClear && "group-hover:opacity-0",
                                adornmentColor,
                            )}
                        />
                        {showClear ? (
                            <button
                                type="button"
                                tabIndex={-1}
                                data-date-range-clear
                                aria-label="Clear date range"
                                className={cn(
                                    "absolute inset-0 flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 opacity-0 transition-opacity hover:text-foreground",
                                    "group-hover:opacity-100 group-focus-within:opacity-100",
                                    adornmentColor,
                                )}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    onChange?.({})
                                }}
                            >
                                <X className="size-3" />
                            </button>
                        ) : null}
                    </span>
                </div>
            </PopoverAnchor>
            <PopoverContent
                align="start"
                container={container}
                aria-label={ariaLabel ?? "Date range"}
                onOpenAutoFocus={(event) => event.preventDefault()}
                className={cn("p-0 font-portal", contentClassName)}
            >
                <DateRangeCalendar {...calendarProps} value={value} onChange={onChange} />
            </PopoverContent>
        </Popover>
    )
}
