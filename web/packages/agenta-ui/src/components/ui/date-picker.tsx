/**
 * DatePicker
 *
 * The shadcn date-picker composition: a {@link Calendar} inside a {@link Popover} behind a button
 * trigger. Replaces the native `type="date"` fallback the package used before a calendar primitive
 * existed.
 *
 * Values are `dayjs` in and out, converting to a native `Date` only at the react-day-picker
 * boundary. That keeps the contract the existing date controls established, so ISO serialization
 * and draft partitioning upstream stay untouched.
 *
 * @example
 * ```tsx
 * <DatePicker value={start} onChange={setStart} placeholder="Start date" />
 * ```
 */
import * as React from "react"

import {dayjs} from "@agenta/shared/utils"
import {CalendarBlank} from "@phosphor-icons/react"

import {Button} from "./button"
import {Calendar} from "./calendar"
import {Popover, PopoverContent, PopoverTrigger} from "./popover"
import {cn} from "./utils"

type Dayjs = ReturnType<typeof dayjs>

export interface DatePickerProps {
    value?: Dayjs | null
    onChange?: (value: Dayjs | undefined) => void
    placeholder?: string
    disabled?: boolean
    /** Display format for the trigger label. @default "YYYY-MM-DD" */
    format?: string
    className?: string
    id?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}

function DatePicker({
    value,
    onChange,
    placeholder = "Pick a date",
    disabled,
    format = "YYYY-MM-DD",
    className,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}: DatePickerProps) {
    const [open, setOpen] = React.useState(false)
    const valid = value && dayjs(value).isValid() ? dayjs(value) : undefined

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    // A trigger button is not named by its contents when it shows a placeholder,
                    // so fall back to the placeholder the same way SelectControl does.
                    aria-label={ariaLabelledby ? undefined : (ariaLabel ?? placeholder)}
                    aria-labelledby={ariaLabelledby}
                    className={cn("w-full justify-between font-normal", className)}
                >
                    <span className={cn(!valid && "text-[var(--ag-colorTextPlaceholder)]")}>
                        {valid ? valid.format(format) : placeholder}
                    </span>
                    <CalendarBlank size={14} className="text-[var(--ag-colorIcon)]" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="single"
                    autoFocus
                    selected={valid?.toDate()}
                    defaultMonth={valid?.toDate()}
                    // required: react-day-picker deselects the active day on re-click in single
                    // mode, which would silently clear a DateTimePicker's combined value.
                    required
                    onSelect={(next) => {
                        if (!next) return
                        onChange?.(dayjs(next))
                        setOpen(false)
                    }}
                />
            </PopoverContent>
        </Popover>
    )
}

export {DatePicker}
