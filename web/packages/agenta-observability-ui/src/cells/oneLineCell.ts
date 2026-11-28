/**
 * Table cells hold one line, so every row is `row-single` (36) on the row scale (ROW-01).
 * The full value is one click away in the cell's popover.
 */
export const ONE_LINE_CELL = "h-5 overflow-hidden [&_*]:truncate [&_*]:!whitespace-nowrap"

/**
 * The last message on one line: its role label is left out (the popover keeps it), so the table
 * shows one color, not a blue role over every row (LOUD-04).
 */
export const ONE_LINE_MESSAGE_CELL = `${ONE_LINE_CELL} [&_section>span:first-child]:hidden`
