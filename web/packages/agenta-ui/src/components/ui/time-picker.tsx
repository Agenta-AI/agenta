/**
 * TimePicker
 *
 * A time-of-day control built from the same primitives as {@link DatePicker} — a Popover behind a
 * button trigger, holding scrollable hour and minute columns. Deliberately NOT a native
 * `<input type="time">`: the native control renders per-locale chrome (12-hour "AM/PM" in some
 * locales, 24-hour in others), can't be themed, and doesn't match the Calendar it sits beside.
 *
 * Values are `"HH:mm"` strings in 24-hour form — what cron and the schedule builder speak —
 * regardless of how the surrounding locale would have displayed a native field.
 *
 * @example
 * ```tsx
 * <TimePicker value="09:30" onChange={setTime} step={300} />
 * ```
 */
import * as React from "react"

import {Clock} from "@phosphor-icons/react"

import {Button} from "./button"
import {Popover, PopoverContent, PopoverTrigger} from "./popover"
import {cn} from "./utils"

export interface TimePickerProps {
    /** `"HH:mm"`, 24-hour. Empty string or undefined means unset. */
    value?: string
    onChange?: (value: string) => void
    placeholder?: string
    disabled?: boolean
    /**
     * Minute granularity in SECONDS, matching the native `step` this replaces — 300 gives
     * 5-minute increments. @default 60
     */
    step?: number
    className?: string
    id?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}

const pad2 = (n: number) => String(n).padStart(2, "0")

function parse(value?: string): {hour: number; minute: number} | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? "")
    if (!m) return null
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (hour > 23 || minute > 59) return null
    return {hour, minute}
}

/** One scrollable column; the selected row is scrolled into view whenever the panel opens. */
function Column({
    label,
    options,
    selected,
    onPick,
}: {
    label: string
    options: number[]
    selected: number | null
    onPick: (value: number) => void
}) {
    const ref = React.useRef<HTMLDivElement>(null)
    React.useEffect(() => {
        ref.current?.querySelector('[data-selected="true"]')?.scrollIntoView({block: "center"})
    }, [])

    return (
        <div className="flex min-w-0 flex-col">
            <span className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ag-colorTextDescription)]">
                {label}
            </span>
            <div
                ref={ref}
                // A modal host's scroll lock swallows wheel events on portaled content; apply
                // the delta ourselves so the column still scrolls.
                onWheel={(e) => {
                    const el = e.currentTarget
                    if (el.scrollHeight <= el.clientHeight) return
                    el.scrollTop += e.deltaY
                    e.stopPropagation()
                }}
                className="flex max-h-[188px] flex-col gap-0.5 overflow-y-auto px-1"
            >
                {options.map((option) => {
                    const active = option === selected
                    return (
                        <button
                            key={option}
                            type="button"
                            data-selected={active}
                            onClick={() => onPick(option)}
                            className={cn(
                                "shrink-0 rounded border-0 px-3 py-1 text-center text-xs tabular-nums",
                                active
                                    ? "bg-primary text-btn-primary-fg"
                                    : "bg-transparent text-[var(--ag-colorTextSecondary)] hover:bg-[var(--ag-colorFillQuaternary)]",
                            )}
                        >
                            {pad2(option)}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

function TimePicker({
    value,
    onChange,
    placeholder = "--:--",
    disabled,
    step = 60,
    className,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}: TimePickerProps) {
    const [open, setOpen] = React.useState(false)
    const current = parse(value)

    const minuteStep = Math.max(1, Math.round(step / 60))
    const hours = React.useMemo(() => Array.from({length: 24}, (_, i) => i), [])
    const minutes = React.useMemo(() => {
        const out: number[] = []
        for (let m = 0; m < 60; m += minuteStep) out.push(m)
        // A stored value off the step grid stays selectable rather than snapping to a neighbour.
        if (current && !out.includes(current.minute)) out.push(current.minute)
        return out.sort((a, b) => a - b)
    }, [minuteStep, current?.minute])

    // Editing one column keeps the other; the untouched half defaults to :00 / 00: when unset.
    const emit = (next: {hour?: number; minute?: number}) => {
        const hour = next.hour ?? current?.hour ?? 0
        const minute = next.minute ?? current?.minute ?? 0
        onChange?.(`${pad2(hour)}:${pad2(minute)}`)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    aria-label={ariaLabelledby ? undefined : (ariaLabel ?? placeholder)}
                    aria-labelledby={ariaLabelledby}
                    className={cn("justify-between font-normal", className)}
                >
                    <span
                        className={cn(
                            "tabular-nums",
                            !current && "text-[var(--ag-colorTextPlaceholder)]",
                        )}
                    >
                        {current ? `${pad2(current.hour)}:${pad2(current.minute)}` : placeholder}
                    </span>
                    <Clock size={14} className="text-[var(--ag-colorIcon)]" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
                <div className="flex gap-1">
                    <Column
                        label="Hour"
                        options={hours}
                        selected={current?.hour ?? null}
                        onPick={(hour) => emit({hour})}
                    />
                    <span className="my-1 w-px shrink-0 bg-[var(--ag-colorBorderSecondary)]" />
                    <Column
                        label="Min"
                        options={minutes}
                        selected={current?.minute ?? null}
                        onPick={(minute) => emit({minute})}
                    />
                </div>
            </PopoverContent>
        </Popover>
    )
}

export {TimePicker}
