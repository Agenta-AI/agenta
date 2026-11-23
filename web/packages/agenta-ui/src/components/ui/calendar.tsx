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
                caption_label: "text-label text-foreground",
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
                    "w-8 rounded-md text-meta text-muted-foreground",
                week: "flex w-full mt-1.5",
                day: "relative h-8 w-8 p-0 text-center text-label",
                day_button: cn(
                    buttonVariants({variant: "ghost"}),
                    "h-8 w-8 p-0 font-normal aria-selected:opacity-100",
                ),
                // Selected has to beat the ghost button's hover skin, hence the restated hover.
                selected:
                    "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button:hover]:bg-primary-hover [&>button:hover]:text-primary-foreground",
                today: "[&>button]:border [&>button]:border-solid [&>button]:border-primary",
                outside: "[&>button]:text-muted-foreground",
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
