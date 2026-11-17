import type {CSSProperties} from "react"

/**
 * The frame of the wizard sheet: a bottom sheet from 640 px up to the desktop width, a full
 * screen sheet below 640 px, and the right-edge drawer from `lg` up.
 */
export const SHEET_FRAME = {
    side: "responsive",
    style: {"--ag-sheet-responsive-width": "640px"} as CSSProperties,
    className: "overflow-hidden max-sm:inset-0 max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none",
} as const

/**
 * The new evaluation sheet's frame: the same sheet, but from `lg` up wide enough for the step
 * list and the step tables side by side, as in the /w modal (at most 90% of the window).
 */
export const WIDE_SHEET_FRAME = {
    ...SHEET_FRAME,
    style: {"--ag-sheet-responsive-width": "1200px"} as CSSProperties,
} as const
