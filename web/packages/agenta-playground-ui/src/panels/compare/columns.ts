/**
 * The compare view lines its columns up across the config area and the run area: the lead column
 * (variants above, inputs below) and one column per revision have the same width in both, so
 * the two areas can scroll sideways in step. From `md` up the lead column sticks at the left.
 * Below `md` the columns stack, each as wide as the screen, so the page never scrolls sideways.
 */
export const LEAD_COLUMN =
    "w-full shrink-0 border-0 border-r border-solid border-border bg-background max-md:border-b max-md:border-r-0 md:sticky md:left-0 md:z-[5] md:w-[360px]"
export const REVISION_COLUMN =
    "w-full shrink-0 border-0 border-r border-solid border-border max-md:border-b max-md:border-r-0 md:w-auto md:min-w-[400px] md:flex-1"
