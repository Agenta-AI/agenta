/**
 * Calendar
 *
 * The shadcn Calendar over `react-day-picker`. Every visual is driven by the antd semantic
 * tokens (`--ag-color*`) rather than react-day-picker's own stylesheet, so the grid follows the
 * app's light/dark theme without importing `react-day-picker/style.css`.
 *
 * This is the primitive the package was missing — `DateTimeInput` and the schedule drawer both
 * fell back to native browser pickers because no calendar existed here. Compose it with
 * {@link Popover} directly, or use the {@link DatePicker} wrapper which already does.
 *
 * @example
 * ```tsx
 * <Calendar mode="single" selected={date} onSelect={setDate} />
 * ```
 */
import * as React from "react"

import {CaretLeft, CaretRight} from "@phosphor-icons/react"
import {DayPicker, type DayPickerProps} from "react-day-picker"

import {buttonVariants} from "./button"
import {cn} from "./utils"

export type CalendarProps = DayPickerProps & {
    /** Additional class for the calendar root. */
    className?: string
}

function Calendar({className, classNames, showOutsideDays = true, ...props}: CalendarProps) {
    return (
        <DayPicker
            showOutsideDays={showOutsideDays}
            className={cn("p-3", className)}
            classNames={{
                months: "flex flex-col sm:flex-row gap-4",
                month: "flex flex-col gap-4",
                month_caption: "flex justify-center pt-1 relative items-center h-7",
                caption_label: "text-sm font-medium text-[var(--ag-colorText)]",
                // z-10 is load-bearing: `nav` is absolute but precedes the (relative)
                // month_caption in the DOM, so without it the caption paints over the arrows
                // and eats their clicks.
                nav: "flex items-center gap-1 absolute inset-x-0 top-1 z-10 justify-between px-1",
                button_previous: cn(
                    buttonVariants({variant: "outline", size: "icon-sm"}),
                    "opacity-60 hover:opacity-100",
                ),
                button_next: cn(
                    buttonVariants({variant: "outline", size: "icon-sm"}),
                    "opacity-60 hover:opacity-100",
                ),
                month_grid: "w-full border-collapse space-y-1",
                weekdays: "flex",
                weekday:
                    "w-8 rounded-md text-[0.75rem] font-normal text-[var(--ag-colorTextDescription)]",
                week: "flex w-full mt-1.5",
                day: "relative h-8 w-8 p-0 text-center text-sm",
                day_button: cn(
                    buttonVariants({variant: "ghost"}),
                    "h-8 w-8 p-0 font-normal aria-selected:opacity-100",
                ),
                // Selected has to beat the ghost button's hover skin, hence the restated hover.
                // `btn-primary-fg` (not colorTextLightSolid) because dark mode flips primary to
                // brand yellow — white on it fails contrast; this token tracks the mode.
                selected:
                    "[&>button]:bg-primary [&>button]:text-btn-primary-fg [&>button:hover]:bg-btn-primary-hover [&>button:hover]:text-btn-primary-fg",
                today: "[&>button]:border [&>button]:border-solid [&>button]:border-[var(--ag-colorPrimary)]",
                outside: "[&>button]:text-[var(--ag-colorTextDisabled)]",
                disabled: "[&>button]:pointer-events-none [&>button]:opacity-40",
                hidden: "invisible",
                ...classNames,
            }}
            components={{
                // v10 routes both arrows through one Chevron slot; `orientation` picks the glyph.
                // Only className/style are forwarded — `disabled` is not a valid SVG attribute.
                Chevron: ({orientation, className: chevronClass, style}) =>
                    orientation === "left" ? (
                        <CaretLeft size={14} className={chevronClass} style={style} />
                    ) : (
                        <CaretRight size={14} className={chevronClass} style={style} />
                    ),
            }}
            {...props}
        />
    )
}

export {Calendar}
