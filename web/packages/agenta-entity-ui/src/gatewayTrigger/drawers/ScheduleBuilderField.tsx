import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    builderToCron,
    cronToBuilder,
    formatNextRun,
    summarizeSchedule,
    timesFormCleanGrid,
    validateCron,
    type CronCadence,
    type CronTimeOfDay,
    type ScheduleBuilderState,
} from "@agenta/entities/gatewayTrigger"
import {message} from "@agenta/ui"
import {
    Button,
    cn,
    Field,
    Input,
    Popover,
    PopoverContent,
    PopoverTrigger,
    selectTriggerVariants,
    TimePicker,
} from "@agenta/ui/ui"
import {CalendarBlank, Clock, Plus, X} from "@phosphor-icons/react"
import {ChevronDown} from "lucide-react"

// ---------------------------------------------------------------------------
// ScheduleBuilderField — the collapsed "Schedule" row and the popover behind it.
//
// The cron string (the `value` prop) stays the source of truth: the builder edits a
// representable subset and the "Cron" preset is the raw editor for anything it can't draw.
// The row shows the schedule in words plus the next run; everything editable lives in the
// popover, so the form reads as five short fields rather than an open control panel.
// ---------------------------------------------------------------------------

const CADENCES: {value: CronCadence; label: string}[] = [
    {value: "hourly", label: "Hourly"},
    {value: "daily", label: "Daily"},
    {value: "weekly", label: "Weekly"},
    {value: "monthly", label: "Monthly"},
    {value: "custom", label: "Cron"},
]

// Mon-first display order; values follow the cron convention (0 = Sunday).
const WEEKDAYS: {value: number; label: string}[] = [
    {value: 1, label: "Mon"},
    {value: 2, label: "Tue"},
    {value: 3, label: "Wed"},
    {value: 4, label: "Thu"},
    {value: 5, label: "Fri"},
    {value: 6, label: "Sat"},
    {value: 0, label: "Sun"},
]

// Common intervals as chips. An expression outside this set stays selected and joins the row
// (see `intervalOptions`), so a stored `*/5` is never silently rounded to a neighbouring chip.
const INTERVALS = [1, 2, 3, 4, 6, 8, 12]
const MINUTES = [0, 15, 30, 45]
const DAYS_OF_MONTH = Array.from({length: 31}, (_, i) => i + 1)

function fmtTime(t: CronTimeOfDay): string {
    return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`
}

function parseTime(v: string): CronTimeOfDay | null {
    const m = /^(\d{2}):(\d{2})$/.exec(v)
    if (!m) return null
    return {hour: Number(m[1]), minute: Number(m[2])}
}

function sortTimes(times: CronTimeOfDay[]): CronTimeOfDay[] {
    return [...times].sort((a, b) => a.hour - b.hour || a.minute - b.minute)
}

export function ScheduleBuilderField({
    value,
    onChange,
}: {
    value: string
    onChange: (cron: string) => void
}) {
    const [builder, setBuilder] = useState<ScheduleBuilderState>(() => cronToBuilder(value).state)
    const [open, setOpen] = useState(false)
    const lastEmitted = useRef(value)

    // External cron change (edit-mode prefill, or a value set elsewhere) — re-derive
    // the builder. Skipped when we ourselves emitted it, so local state isn't clobbered.
    useEffect(() => {
        if (value === lastEmitted.current) return
        lastEmitted.current = value
        setBuilder(cronToBuilder(value).state)
    }, [value])

    const emit = useCallback(
        (next: ScheduleBuilderState) => {
            setBuilder(next)
            const cron = builderToCron(next)
            lastEmitted.current = cron
            onChange(cron)
        },
        [onChange],
    )

    // Raw cron typed in the Cron editor — stays in Cron (the user chose it); re-deriving
    // the cadence per keystroke would yank the editor out from under them.
    const onCronText = useCallback(
        (text: string) => {
            lastEmitted.current = text
            setBuilder((b) => ({...b, cadence: "custom", cron: text}))
            onChange(text)
        },
        [onChange],
    )

    const selectCadence = useCallback(
        (cadence: CronCadence) => {
            if (cadence === builder.cadence) return
            if (cadence === "custom") {
                emit({...builder, cadence: "custom", cron: builderToCron(builder)})
                return
            }
            if (builder.cadence === "custom") {
                // Lossless when the raw expression already maps to that cadence; otherwise the
                // switch replaces it, which the Cron chip reverses by re-showing the generated one.
                const parsed = cronToBuilder(builder.cron)
                if (parsed.representable && parsed.state.cadence === cadence) {
                    emit(parsed.state)
                    return
                }
            }
            emit({...builder, cadence})
        },
        [builder, emit],
    )

    const validation = useMemo(() => validateCron(value), [value])
    const summary = validation.valid ? summarizeSchedule(builder) : value
    const nextLine = useMemo(
        () => (validation.valid ? formatNextRun(value, builder) : ""),
        [validation.valid, value, builder],
    )

    return (
        <Field error={validation.valid ? undefined : validation.error}>
            <div className="flex flex-col gap-1.5">
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        {/* Styled as a Select trigger, not a Button: this reads as a field, and
                            must line up with the Name input and the Agent select beside it. The
                            height derives from padding + line-height, as Input's does. */}
                        <button
                            type="button"
                            className={cn(selectTriggerVariants(), "h-auto py-input-y")}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <CalendarBlank
                                    size={14}
                                    className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                                />
                                <span className="min-w-0 truncate">{summary}</span>
                            </span>
                            {/* Same glyph SelectTrigger renders, so the two fields match. */}
                            <ChevronDown className="size-3 shrink-0 text-placeholder" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="start"
                        className="flex w-[var(--radix-popover-trigger-width)] flex-col gap-3.5 p-4"
                    >
                        <ChipRow label="Cadence">
                            {CADENCES.map((c) => (
                                <Chip
                                    key={c.value}
                                    active={c.value === builder.cadence}
                                    onClick={() => selectCadence(c.value)}
                                >
                                    {c.label}
                                </Chip>
                            ))}
                        </ChipRow>

                        {builder.cadence === "weekly" && (
                            <ChipRow label="Days">
                                {WEEKDAYS.map((d) => (
                                    <Chip
                                        key={d.value}
                                        active={builder.weekdays.includes(d.value)}
                                        onClick={() =>
                                            emit({
                                                ...builder,
                                                weekdays: toggle(builder.weekdays, d.value),
                                            })
                                        }
                                    >
                                        {d.label}
                                    </Chip>
                                ))}
                            </ChipRow>
                        )}

                        {builder.cadence === "monthly" && (
                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>Days of the month</FieldLabel>
                                <div className="grid grid-cols-7 gap-1">
                                    {DAYS_OF_MONTH.map((d) => {
                                        const active = builder.daysOfMonth.includes(d)
                                        return (
                                            <Button
                                                key={d}
                                                variant={active ? "default" : "outline"}
                                                aria-pressed={active}
                                                onClick={() =>
                                                    emit({
                                                        ...builder,
                                                        daysOfMonth: toggle(builder.daysOfMonth, d),
                                                    })
                                                }
                                                className="w-full px-0 text-xs"
                                            >
                                                {d}
                                            </Button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {builder.cadence === "hourly" && (
                            <>
                                <ChipRow label="Every">
                                    {intervalOptions(builder.everyNHours).map((n) => (
                                        <Chip
                                            key={n}
                                            active={n === builder.everyNHours}
                                            onClick={() => emit({...builder, everyNHours: n})}
                                        >
                                            {n}h
                                        </Chip>
                                    ))}
                                </ChipRow>
                                <ChipRow label="At minute">
                                    {minuteOptions(builder.times[0]?.minute ?? 0).map((m) => (
                                        <Chip
                                            key={m}
                                            active={m === (builder.times[0]?.minute ?? 0)}
                                            onClick={() =>
                                                emit({...builder, times: [{hour: 0, minute: m}]})
                                            }
                                        >
                                            :{String(m).padStart(2, "0")}
                                        </Chip>
                                    ))}
                                </ChipRow>
                            </>
                        )}

                        {builder.cadence === "custom" && (
                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>Expression</FieldLabel>
                                <Input
                                    placeholder="minute hour day month weekday (UTC)"
                                    value={value}
                                    onChange={(e) => onCronText(e.target.value)}
                                    aria-invalid={validation.valid ? undefined : true}
                                    aria-label="Cron expression"
                                    className="font-mono"
                                />
                                <span className="text-xs leading-snug text-[var(--ag-colorTextDescription)]">
                                    5-field cron in UTC (e.g. 0 9 * * * = every day at 09:00 UTC).
                                </span>
                            </div>
                        )}

                        {builder.cadence !== "custom" && builder.cadence !== "hourly" && (
                            <TimesField
                                times={builder.times}
                                onChange={(times) => emit({...builder, times})}
                            />
                        )}

                        {nextLine ? (
                            <div className="flex items-center gap-2 border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] pt-3">
                                <Clock
                                    size={14}
                                    className="shrink-0 text-[var(--ag-colorTextSecondary)]"
                                />
                                <span className="text-xs text-[var(--ag-colorTextDescription)]">
                                    {nextLine}
                                </span>
                            </div>
                        ) : null}
                    </PopoverContent>
                </Popover>

                {nextLine ? (
                    <span className="text-xs leading-snug text-[var(--ag-colorTextDescription)]">
                        {nextLine}
                    </span>
                ) : null}
            </div>
        </Field>
    )
}

// ---------------------------------------------------------------------------
// TimesField — one or more run times. The last one can't be removed, so the list is never
// empty (an empty list would emit `0 0 * * *` and silently reschedule to midnight). Cron's
// minute and hour fields are independent, so a time that would force cross-product runs is
// refused with a hint to use a second schedule.
// ---------------------------------------------------------------------------

const GRID_WARNING =
    "Cron can't combine these times in one schedule — they'd trigger extra runs. Add a second schedule instead."

function TimesField({
    times,
    onChange,
}: {
    times: CronTimeOfDay[]
    onChange: (times: CronTimeOfDay[]) => void
}) {
    const sorted = sortTimes(times)

    const commit = (next: CronTimeOfDay[]) => {
        if (!timesFormCleanGrid(next)) {
            message.warning(GRID_WARNING)
            return
        }
        onChange(sortTimes(next))
    }

    // Appends the first free 5-minute slot from 09:00; the new field is immediately editable.
    const addTime = () => {
        const t: CronTimeOfDay = {hour: 9, minute: 0}
        while (sorted.some((x) => sameTime(x, t))) {
            t.minute += 5
            if (t.minute >= 60) {
                t.minute = 0
                t.hour = (t.hour + 1) % 24
            }
        }
        commit([...sorted, t])
    }

    // Rejected edits keep the old value: the input is controlled off `times`.
    const setTimeAt = (index: number, next: string) => {
        const t = parseTime(next)
        if (!t) return
        if (sorted.some((x, i) => i !== index && sameTime(x, t))) return
        commit(sorted.map((x, i) => (i === index ? t : x)))
    }

    return (
        <div className="flex flex-col gap-1.5">
            <FieldLabel>Time (UTC)</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
                {sorted.map((t, i) => (
                    <span key={fmtTime(t)} className="flex items-center">
                        <TimePicker
                            step={300}
                            value={fmtTime(t)}
                            onChange={(next) => setTimeAt(i, next)}
                            aria-label={`Run time ${fmtTime(t)} (UTC)`}
                            className="w-[104px]"
                        />
                        {sorted.length > 1 && (
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove ${fmtTime(t)}`}
                                onClick={() => onChange(sorted.filter((_, j) => j !== i))}
                            >
                                <X size={12} />
                            </Button>
                        )}
                    </span>
                ))}
                <Button variant="dashed" onClick={addTime}>
                    <Plus size={13} />
                    Add
                </Button>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function Chip({
    active,
    onClick,
    children,
}: {
    active: boolean
    onClick: () => void
    children: ReactNode
}) {
    // A chip is a Button widened to share the row — no bespoke geometry. Only the type size is
    // pinned, to the 13px the rest of the popover uses.
    return (
        <Button
            variant={active ? "default" : "outline"}
            aria-pressed={active}
            onClick={onClick}
            className="flex-1 px-2 text-xs"
        >
            {children}
        </Button>
    )
}

function ChipRow({label, children}: {label: string; children: ReactNode}) {
    return (
        <div className="flex flex-col gap-1.5">
            <FieldLabel>{label}</FieldLabel>
            <div className="flex gap-1">{children}</div>
        </div>
    )
}

function FieldLabel({children}: {children: ReactNode}) {
    return <span className="text-xs text-[var(--ag-colorTextDescription)]">{children}</span>
}

// The chip set, widened to include a stored value the presets don't cover (e.g. a 5-hour step).
function intervalOptions(current: number): number[] {
    return INTERVALS.includes(current) ? INTERVALS : [...INTERVALS, current].sort((a, b) => a - b)
}

function minuteOptions(current: number): number[] {
    return MINUTES.includes(current) ? MINUTES : [...MINUTES, current].sort((a, b) => a - b)
}

function sameTime(a: CronTimeOfDay, b: CronTimeOfDay): boolean {
    return a.hour === b.hour && a.minute === b.minute
}

function toggle(list: number[], value: number): number[] {
    if (list.includes(value)) {
        // Keep at least one selected.
        return list.length > 1 ? list.filter((v) => v !== value) : list
    }
    return [...list, value]
}

export default ScheduleBuilderField
