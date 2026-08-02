import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {
    builderToCron,
    cronToBuilder,
    describeBuilder,
    nextCronRuns,
    timesFormCleanGrid,
    validateCron,
    type CronCadence,
    type CronTimeOfDay,
    type ScheduleBuilderState,
} from "@agenta/entities/gatewayTrigger"
import {message, modal} from "@agenta/ui"
import {Alert, Button, Combobox, Field, Input, InputNumber} from "@agenta/ui/ui"
import {Plus, X} from "@phosphor-icons/react"

import {MultiSelect} from "../../gatewayTool/components/schemaFormControls"

const CADENCES: {value: CronCadence; label: string}[] = [
    {value: "hourly", label: "Hourly"},
    {value: "daily", label: "Daily"},
    {value: "weekly", label: "Weekly"},
    {value: "monthly", label: "Monthly"},
    {value: "custom", label: "Custom"},
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

const DOM_OPTIONS = Array.from({length: 31}, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
}))

function cadenceLabel(cadence: CronCadence): string {
    return CADENCES.find((c) => c.value === cadence)?.label ?? cadence
}

function fmtTime(t: CronTimeOfDay): string {
    return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`
}

function sortTimes(times: CronTimeOfDay[]): CronTimeOfDay[] {
    return [...times].sort((a, b) => a.hour - b.hour || a.minute - b.minute)
}

function fmtRun(d: Date): string {
    return d.toISOString().replace("T", " ").replace(":00.000Z", " UTC")
}

// ---------------------------------------------------------------------------
// ScheduleBuilderField — friendly two-pane schedule builder over a cron string.
// The cron string (the `value` prop) stays the source of truth: the builder
// edits a representable subset; the "Custom" cadence is the raw-cron editor for
// anything the visual builder can't draw.
// ---------------------------------------------------------------------------

export function ScheduleBuilderField({
    value,
    onChange,
}: {
    value: string
    onChange: (cron: string) => void
}) {
    const [builder, setBuilder] = useState<ScheduleBuilderState>(() => cronToBuilder(value).state)
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

    // Raw cron typed in the Custom editor — stays in Custom (the user chose it);
    // re-deriving cadence per keystroke would yank the editor out from under them.
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
                // Lossless when the custom expression already maps to that cadence.
                const parsed = cronToBuilder(builder.cron)
                if (parsed.representable && parsed.state.cadence === cadence) {
                    emit(parsed.state)
                    return
                }
                // The @agenta/ui `modal` service portals its own themed surface, so the
                // antd useModal contextHolder dance is gone.
                modal.confirm({
                    title: `Switch to ${cadenceLabel(cadence)}?`,
                    content: "This replaces your custom cron expression.",
                    okText: "Switch",
                    cancelText: "Cancel",
                    onOk: () => emit({...builder, cadence}),
                })
                return
            }
            emit({...builder, cadence})
        },
        [builder, emit],
    )

    const validation = useMemo(() => validateCron(value), [value])
    const summary = validation.valid ? describeBuilder(builder) : null
    const nextRun = useMemo(
        () => (validation.valid ? nextCronRuns(value, 1)[0] : undefined),
        [validation.valid, value],
    )

    // In Custom: if the expression is actually a builder shape, offer to switch.
    const customMatch = useMemo(() => {
        if (builder.cadence !== "custom") return null
        const parsed = cronToBuilder(value)
        return parsed.representable ? parsed.state.cadence : null
    }, [builder.cadence, value])

    return (
        <Field error={validation.valid ? undefined : validation.error}>
            <div>
                <div className="flex gap-3">
                    <div className="flex w-[116px] shrink-0 flex-col gap-0.5">
                        {CADENCES.map((c) => {
                            const active = c.value === builder.cadence
                            return (
                                <Button
                                    key={c.value}
                                    variant="ghost"
                                    onClick={() => selectCadence(c.value)}
                                    className={`h-8 w-full justify-start px-2.5 text-xs ${
                                        active
                                            ? "bg-[var(--ag-colorPrimaryBg)] font-medium text-[var(--ag-colorPrimary)] hover:bg-[var(--ag-colorPrimaryBg)] hover:text-[var(--ag-colorPrimary)]"
                                            : "text-[var(--ag-colorTextSecondary)]"
                                    }`}
                                >
                                    {c.label}
                                </Button>
                            )
                        })}
                    </div>

                    <div className="min-w-0 flex-1 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                        {builder.cadence === "custom" ? (
                            <CronEditor
                                value={value}
                                onChange={onCronText}
                                valid={validation.valid}
                                match={customMatch}
                                onUseBuilder={selectCadence}
                            />
                        ) : (
                            <CadenceDetails builder={builder} onChange={emit} />
                        )}
                    </div>
                </div>

                {summary && (
                    <Alert
                        type="success"
                        showIcon
                        className="mt-3 py-1.5"
                        message={
                            <span className="text-xs leading-snug">
                                <span className="font-medium">{summary}</span>
                                {nextRun ? <> · next {fmtRun(nextRun)}</> : null}
                            </span>
                        }
                    />
                )}
            </div>
        </Field>
    )
}

// ---------------------------------------------------------------------------
// CadenceDetails — the right pane for a visual cadence; fields depend on it.
// ---------------------------------------------------------------------------

function CadenceDetails({
    builder,
    onChange,
}: {
    builder: ScheduleBuilderState
    onChange: (next: ScheduleBuilderState) => void
}) {
    if (builder.cadence === "hourly") {
        const minute = builder.times[0]?.minute ?? 0
        return (
            <div className="flex flex-col gap-2">
                <FieldLabel>Run every</FieldLabel>
                <div className="flex items-center gap-2">
                    <InputNumber
                        min={1}
                        max={23}
                        aria-label="Hour"
                        value={builder.everyNHours}
                        onChange={(n) =>
                            onChange({...builder, everyNHours: Math.max(1, Number(n) || 1)})
                        }
                        className="w-20"
                    />
                    <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                        hours, at minute
                    </span>
                    <InputNumber
                        min={0}
                        max={59}
                        aria-label="Minute"
                        value={minute}
                        onChange={(m) =>
                            onChange({
                                ...builder,
                                times: [{hour: 0, minute: clamp(Number(m) || 0, 0, 59)}],
                            })
                        }
                        className="w-16"
                    />
                </div>
            </div>
        )
    }

    if (builder.cadence === "weekly") {
        return (
            <div className="flex flex-col gap-3">
                <div>
                    <FieldLabel>On these days</FieldLabel>
                    <div className="mt-1.5 flex gap-1">
                        {WEEKDAYS.map((d) => (
                            <Button
                                key={d.value}
                                variant={builder.weekdays.includes(d.value) ? "default" : "outline"}
                                onClick={() =>
                                    onChange({
                                        ...builder,
                                        weekdays: toggle(builder.weekdays, d.value),
                                    })
                                }
                                className="flex-1 px-1"
                            >
                                {d.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <TimesField
                    times={builder.times}
                    onChange={(times) => onChange({...builder, times})}
                />
            </div>
        )
    }

    if (builder.cadence === "monthly") {
        return (
            <div className="flex flex-col gap-3">
                <div>
                    <FieldLabel>On day(s) of the month</FieldLabel>
                    <DaysOfMonthSelect
                        value={builder.daysOfMonth}
                        onChange={(days) =>
                            onChange({
                                ...builder,
                                daysOfMonth: days.length ? days : builder.daysOfMonth,
                            })
                        }
                    />
                </div>
                <TimesField
                    times={builder.times}
                    onChange={(times) => onChange({...builder, times})}
                />
            </div>
        )
    }

    // daily
    return <TimesField times={builder.times} onChange={(times) => onChange({...builder, times})} />
}

// ---------------------------------------------------------------------------
// DaysOfMonthSelect — replaces the antd multi-Select (`mode="multiple"`) with
// the shared gatewayTool MultiSelect (chips-in-trigger over checkbox items);
// the @agenta/ui Select is deliberately single-select.
// ---------------------------------------------------------------------------

function DaysOfMonthSelect({
    value,
    onChange,
}: {
    value: number[]
    onChange: (days: number[]) => void
}) {
    const selected = useMemo(() => [...value].sort((a, b) => a - b).map(String), [value])
    return (
        <div className="mt-1.5">
            <MultiSelect
                value={selected}
                onChange={(days) => onChange(days.map(Number).sort((a, b) => a - b))}
                options={DOM_OPTIONS}
                placeholder="Select days"
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// CronEditor — the Custom cadence's detail pane: raw 5-field cron input with a
// hint to jump back to the visual builder when the expression maps to one.
// ---------------------------------------------------------------------------

function CronEditor({
    value,
    onChange,
    valid,
    match,
    onUseBuilder,
}: {
    value: string
    onChange: (next: string) => void
    valid: boolean
    match: CronCadence | null
    onUseBuilder: (cadence: CronCadence) => void
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Input
                placeholder="minute hour day month weekday (UTC)"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-invalid={valid ? undefined : true}
            />
            <span className="text-[11px] leading-snug text-[var(--ag-colorTextDescription)]">
                5-field cron in UTC (e.g.{" "}
                <code className="mx-[0.2em] rounded-[3px] border border-solid border-[rgba(100,100,100,0.2)] bg-[rgba(150,150,150,0.1)] px-[0.4em] pb-[0.1em] pt-[0.2em] text-[85%]">
                    0 9 * * *
                </code>{" "}
                = every day at 09:00 UTC).
            </span>
            {match && (
                <button
                    type="button"
                    className="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-btn-link hover:text-btn-link-hover active:text-btn-link-active"
                    onClick={() => onUseBuilder(match)}
                >
                    This is a {cadenceLabel(match)} schedule — use the builder
                </button>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// TimesField — one or more run times, each a live time input so "this is
// editable" needs no discovering. The last one can't be removed, so the list is
// never empty (an empty list would emit `0 0 * * *` and silently reschedule to
// midnight). Cron's minute and hour fields are independent, so a time that
// would force cross-product runs is refused with a hint to use a second
// schedule.
// ---------------------------------------------------------------------------

const GRID_WARNING =
    "Cron can't combine these times in one schedule — they'd trigger extra runs. Add a second schedule instead."

// 5-minute steps (the antd TimePicker's `minuteStep={5}`), 00:00 … 23:55.
const TIME_OPTIONS = Array.from({length: 24 * 12}, (_, i) => {
    const t = {hour: Math.floor(i / 12), minute: (i % 12) * 5}
    return {value: fmtTime(t), label: fmtTime(t)}
})

function parseTime(v: string): CronTimeOfDay | null {
    const m = /^(\d{2}):(\d{2})$/.exec(v)
    if (!m) return null
    return {hour: Number(m[1]), minute: Number(m[2])}
}

/** antd TimePicker (HH:mm, 5-min steps) → a searchable time select on the Combobox. */
function TimeSelect({
    value,
    onPick,
    ariaLabel,
}: {
    value: CronTimeOfDay
    onPick: (t: CronTimeOfDay) => void
    ariaLabel: string
}) {
    const current = fmtTime(value)
    // A cron-derived time can sit off the 5-minute grid; keep it selectable.
    const options = useMemo(
        () =>
            TIME_OPTIONS.some((o) => o.value === current)
                ? TIME_OPTIONS
                : [...TIME_OPTIONS, {value: current, label: current}].sort((a, b) =>
                      a.value.localeCompare(b.value),
                  ),
        [current],
    )
    return (
        <Combobox
            options={options}
            value={current}
            onChange={(v) => {
                const t = v ? parseTime(v) : null
                if (t) onPick(t)
            }}
            className="w-[104px]"
            aria-label={ariaLabel}
        />
    )
}

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

    // "Add time" appends the first free 5-minute slot from 09:00 (the antd flow opened a
    // transient picker; the new chip is immediately editable, so add-then-edit replaces it).
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
    const setTimeAt = (index: number, t: CronTimeOfDay) => {
        if (sorted.some((x, i) => i !== index && sameTime(x, t))) return
        commit(sorted.map((x, i) => (i === index ? t : x)))
    }

    const removeTimeAt = (index: number) => {
        if (sorted.length <= 1) return
        onChange(sorted.filter((_, i) => i !== index))
    }

    return (
        <div>
            <FieldLabel>At these times (UTC)</FieldLabel>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {sorted.map((t, i) => (
                    <div key={fmtTime(t)} className="flex items-center">
                        <TimeSelect
                            value={t}
                            onPick={(next) => setTimeAt(i, next)}
                            ariaLabel={`Run time ${fmtTime(t)} (UTC)`}
                        />
                        {sorted.length > 1 && (
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove ${fmtTime(t)}`}
                                onClick={() => removeTimeAt(i)}
                            >
                                <X size={12} />
                            </Button>
                        )}
                    </div>
                ))}
                <Button variant="outline" onClick={addTime}>
                    <Plus size={13} />
                    Add time
                </Button>
            </div>
        </div>
    )
}

function sameTime(a: CronTimeOfDay, b: CronTimeOfDay): boolean {
    return a.hour === b.hour && a.minute === b.minute
}

function FieldLabel({children}: {children: ReactNode}) {
    return <span className="text-xs text-[var(--ag-colorTextDescription)]">{children}</span>
}

function toggle(list: number[], value: number): number[] {
    if (list.includes(value)) {
        // Keep at least one selected.
        return list.length > 1 ? list.filter((v) => v !== value) : list
    }
    return [...list, value]
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n))
}

export default ScheduleBuilderField
