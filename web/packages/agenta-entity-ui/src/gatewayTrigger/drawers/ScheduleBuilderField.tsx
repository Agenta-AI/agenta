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
import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {dayjs} from "@agenta/shared/utils"
import {useConfirmDialog} from "@agenta/ui/components/modal"
import {CheckCircle, Plus} from "@phosphor-icons/react"
import {Button, Form, Input, InputNumber, Tag, TimePicker, message} from "antd"

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

const DOM_OPTIONS = Array.from({length: 31}, (_, i) => ({value: i + 1, label: String(i + 1)}))

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
    const {confirm, confirmDialog} = useConfirmDialog()

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
                confirm({
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
        [builder, confirm, emit],
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
        <Form.Item
            className="!mb-0"
            validateStatus={validation.valid ? undefined : "error"}
            help={validation.valid ? undefined : validation.error}
        >
            {confirmDialog}
            <div className="flex gap-3">
                <div className="flex w-[116px] shrink-0 flex-col gap-0.5">
                    {CADENCES.map((c) => {
                        const active = c.value === builder.cadence
                        return (
                            <Button
                                key={c.value}
                                type="text"
                                block
                                onClick={() => selectCadence(c.value)}
                                className={`!h-8 !justify-start !px-2.5 !text-xs ${
                                    active
                                        ? "!bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]"
                                        : "!text-[var(--ag-colorTextSecondary)]"
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
                <Alert variant="success" icon={<CheckCircle size={16} />} className="!mt-3 !py-1.5">
                    <AlertTitle>
                        <span className="text-xs leading-snug">
                            <span className="font-medium">{summary}</span>
                            {nextRun ? <> · next {fmtRun(nextRun)}</> : null}
                        </span>
                    </AlertTitle>
                </Alert>
            )}
        </Form.Item>
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
                                type={builder.weekdays.includes(d.value) ? "primary" : "default"}
                                onClick={() =>
                                    onChange({
                                        ...builder,
                                        weekdays: toggle(builder.weekdays, d.value),
                                    })
                                }
                                className="flex-1 !px-1"
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
                    <Select
                        multiple
                        value={builder.daysOfMonth.map(String)}
                        onValueChange={(days: string[]) =>
                            onChange({
                                ...builder,
                                daysOfMonth: days.length ? days.map(Number) : builder.daysOfMonth,
                            })
                        }
                    >
                        <SelectTrigger className="mt-1.5 w-full">
                            <SelectValue placeholder="Select days" />
                        </SelectTrigger>
                        <SelectContent>
                            {DOM_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={String(o.value)}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
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
                status={valid ? undefined : "error"}
            />
            <span className="!text-[11px] leading-snug text-muted-foreground">
                5-field cron in UTC (e.g. <code>0 9 * * *</code> = every day at 09:00 UTC).
            </span>
            {match && (
                <a className="!text-[11px]" onClick={() => onUseBuilder(match)}>
                    This is a {cadenceLabel(match)} schedule — use the builder
                </a>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// TimesField — one or more run times as removable chips. Cron's minute and hour
// fields are independent, so a new time that would force cross-product runs is
// refused with a hint to use a second schedule.
// ---------------------------------------------------------------------------

function TimesField({
    times,
    onChange,
}: {
    times: CronTimeOfDay[]
    onChange: (times: CronTimeOfDay[]) => void
}) {
    const [adding, setAdding] = useState(false)

    const addTime = (t: CronTimeOfDay) => {
        setAdding(false)
        if (times.some((x) => x.hour === t.hour && x.minute === t.minute)) return
        const next = [...times, t]
        if (!timesFormCleanGrid(next)) {
            message.warning(
                "Cron can't combine these times in one schedule — they'd trigger extra runs. Add a second schedule instead.",
            )
            return
        }
        onChange(sortTimes(next))
    }

    const removeTime = (t: CronTimeOfDay) => {
        if (times.length <= 1) return
        onChange(times.filter((x) => !(x.hour === t.hour && x.minute === t.minute)))
    }

    return (
        <div>
            <FieldLabel>At these times (UTC)</FieldLabel>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {sortTimes(times).map((t) => (
                    <Tag
                        key={fmtTime(t)}
                        closable={times.length > 1}
                        onClose={(e) => {
                            e.preventDefault()
                            removeTime(t)
                        }}
                        className="!m-0 !px-2 !py-1 !text-xs"
                    >
                        {fmtTime(t)}
                    </Tag>
                ))}
                {adding ? (
                    <TimePicker
                        autoFocus
                        open
                        format="HH:mm"
                        minuteStep={5}
                        needConfirm={false}
                        defaultValue={dayjs().hour(9).minute(0)}
                        onChange={(d) => d && addTime({hour: d.hour(), minute: d.minute()})}
                        onOpenChange={(o) => !o && setAdding(false)}
                    />
                ) : (
                    <Button icon={<Plus size={13} />} onClick={() => setAdding(true)}>
                        Add time
                    </Button>
                )}
            </div>
        </div>
    )
}

function FieldLabel({children}: {children: ReactNode}) {
    return <span className="!text-xs text-muted-foreground">{children}</span>
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
