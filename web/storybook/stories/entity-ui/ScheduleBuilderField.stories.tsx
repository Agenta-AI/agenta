import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import type {
    CronCadence,
    CronTimeOfDay,
    ScheduleBuilderState,
} from "@agenta/entities/gatewayTrigger"
import {
    builderToCron,
    cronToBuilder,
    describeBuilder,
    nextCronRuns,
    timesFormCleanGrid,
    validateCron,
} from "@agenta/entities/gatewayTrigger"
import {ScheduleBuilderField} from "@agenta/entity-ui/gatewayTrigger"
import {dayjs} from "@agenta/shared/utils"
import {Plus, X} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Alert,
    Button,
    Form,
    Input,
    InputNumber,
    Modal,
    Select,
    TimePicker,
    Typography,
    message,
} from "antd"

// ScheduleBuilderField — the cron builder behind "When should it run?". The antd half below
// is the ENTIRE pre-migration component, verbatim from feat/storybook-data-seam (antd Form.Item,
// Button rail, InputNumber, multi-Select, TimePicker, Alert, Modal.useModal, message). The
// agenta half is the migrated component (Field, Button, InputNumber, shared MultiSelect,
// composed TimeSelect on Combobox, Alert, @agenta/ui modal/message).
//
// Declared deviations (no @agenta/ui primitives exist for these):
//  - antd TimePicker → TimeSelect (Combobox, 5-min options): select chrome + chevron instead
//    of picker chrome + clock icon; "Add time" appends the next free slot instead of opening
//    a transient picker.
//  - antd Select mode="multiple" → shared gatewayTool MultiSelect (chips over checkbox items).

const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/ScheduleBuilderField",
    component: ScheduleBuilderField,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Two-pane cron builder over a cron string. antd Form.Item/Button/Input/InputNumber/Select-multiple/TimePicker/Alert/Modal.useModal/message replaced by @agenta/ui Field/Button/Input/InputNumber/Alert + shared MultiSelect + a composed TimeSelect (Combobox) + the @agenta/ui modal/message services.",
            },
        },
    },
} satisfies Meta<typeof ScheduleBuilderField>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Row = ({label, cron, expected}: {label: string; cron: string; expected?: string}) => (
    <div
        className="grid grid-cols-[9rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[440px]" data-vrt-subject>
                <AntdScheduleBuilderField value={cron} onChange={noop} />
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[440px]" data-vrt-subject>
                <ScheduleBuilderField value={cron} onChange={noop} />
            </div>
        </div>
    </div>
)

const COMPOSED_NOTE =
    "TimePicker -> composed TimeSelect (Combobox: select chrome + chevron, no clock icon); everything else in the row is gated by eye against this note"

export const AntdVsAgenta: Story = {
    args: {value: "0 9 * * 1", onChange: noop},
    render: () => (
        <div className="flex max-w-[1200px] flex-col">
            <Row label="daily · 0 9 * * *" cron="0 9 * * *" expected={COMPOSED_NOTE} />
            <Row label="weekly · 0 9 * * 1" cron="0 9 * * 1" expected={COMPOSED_NOTE} />
            <Row
                label="monthly · 0 9 1,15 * *"
                cron="0 9 1,15 * *"
                expected={
                    "antd multi-Select -> shared MultiSelect (chips over checkbox items) and TimePicker -> TimeSelect; composed replacements, chrome differs"
                }
            />
            <Row label="hourly · 15 */2 * * *" cron="15 */2 * * *" />
            <Row label="custom · */10 9-17 * * 1-5" cron="*/10 9-17 * * 1-5" />
            <Row
                label="invalid cron (error)"
                cron="not a cron"
                expected="antd Form.Item help line vs Field error line — same text, error colour; layout gated by eye"
            />
        </div>
    ),
}

// ---------------------------------------------------------------------------
// The ENTIRE pre-migration component, verbatim (antd). Interactions are live but
// irrelevant to the VRT; the rows above render it with fixed cron values.
// ---------------------------------------------------------------------------

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

function AntdScheduleBuilderField({
    value,
    onChange,
}: {
    value: string
    onChange: (cron: string) => void
}) {
    const [builder, setBuilder] = useState<ScheduleBuilderState>(() => cronToBuilder(value).state)
    const lastEmitted = useRef(value)
    // Hook form so the confirm renders inside the theme context (static Modal.confirm
    // escapes ConfigProvider → unstyled in dark mode).
    const [modal, modalContextHolder] = Modal.useModal()

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
        [builder, emit, modal],
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
            {modalContextHolder}
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
                <Alert
                    type="success"
                    showIcon
                    className="!mt-3 !py-1.5"
                    message={
                        <span className="text-xs leading-snug">
                            <span className="font-medium">{summary}</span>
                            {nextRun ? <> · next {fmtRun(nextRun)}</> : null}
                        </span>
                    }
                />
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
                        mode="multiple"
                        className="mt-1.5 w-full"
                        value={builder.daysOfMonth}
                        options={DOM_OPTIONS}
                        onChange={(days: number[]) =>
                            onChange({
                                ...builder,
                                daysOfMonth: days.length ? days : builder.daysOfMonth,
                            })
                        }
                        maxTagCount="responsive"
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
            <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                5-field cron in UTC (e.g. <code>0 9 * * *</code> = every day at 09:00 UTC).
            </Typography.Text>
            {match && (
                <Typography.Link className="!text-[11px]" onClick={() => onUseBuilder(match)}>
                    This is a {cadenceLabel(match)} schedule — use the builder
                </Typography.Link>
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

function TimesField({
    times,
    onChange,
}: {
    times: CronTimeOfDay[]
    onChange: (times: CronTimeOfDay[]) => void
}) {
    const [adding, setAdding] = useState(false)
    const sorted = sortTimes(times)

    const commit = (next: CronTimeOfDay[]) => {
        setAdding(false)
        if (!timesFormCleanGrid(next)) {
            message.warning(GRID_WARNING)
            return
        }
        onChange(sortTimes(next))
    }

    const addTime = (t: CronTimeOfDay) => {
        if (sorted.some((x) => sameTime(x, t))) {
            setAdding(false)
            return
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
                        <TimePicker
                            value={dayjs().hour(t.hour).minute(t.minute)}
                            format="HH:mm"
                            minuteStep={5}
                            needConfirm={false}
                            allowClear={false}
                            className="w-[104px]"
                            onChange={(d) =>
                                d && setTimeAt(i, {hour: d.hour(), minute: d.minute()})
                            }
                        />
                        {sorted.length > 1 && (
                            <Button
                                type="text"
                                size="small"
                                aria-label={`Remove ${fmtTime(t)}`}
                                icon={<X size={12} />}
                                onClick={() => removeTimeAt(i)}
                            />
                        )}
                    </div>
                ))}
                {adding ? (
                    <TimePicker
                        autoFocus
                        open
                        format="HH:mm"
                        minuteStep={5}
                        needConfirm={false}
                        className="w-[104px]"
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

function sameTime(a: CronTimeOfDay, b: CronTimeOfDay): boolean {
    return a.hour === b.hour && a.minute === b.minute
}

function FieldLabel({children}: {children: ReactNode}) {
    return (
        <Typography.Text type="secondary" className="!text-xs">
            {children}
        </Typography.Text>
    )
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
