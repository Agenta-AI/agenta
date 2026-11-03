/**
 * The compare view lines its columns up across the config area and the run area: the lead column
 * (variants above, inputs below) and one column per revision have the same width in both, so
 * the two areas can scroll sideways in step. From `md` up the lead column sticks at the left.
 * On a phone each column takes most of the screen and nothing sticks.
 */
export const LEAD_COLUMN =
    "w-[85vw] shrink-0 border-0 border-r border-solid border-border bg-background md:sticky md:left-0 md:z-[5] md:w-[360px]"
export const REVISION_COLUMN =
    "w-[85vw] shrink-0 border-0 border-r border-solid border-border md:w-auto md:min-w-[400px] md:flex-1"
