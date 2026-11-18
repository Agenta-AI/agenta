// calc, not 94%: an exact 8px inset each side, so the row's right edge lines up with the
// 8px-inset collapse toggle in the brand row.
// h-7/text-sm: the rail's own row, and the reading rhythm ChatGPT and Manus keep. A
// 26px/13px pass was tried and read as one packed column with no breathing room.
// gap-[10px], not gap-2: the rail's icon-to-label gap is 10px.
// leading-7, not leading-none: `truncate` clips to the line box, and a line box equal to the
// font size slices the descenders off every g, p and y.
export const ROW_HEIGHT = "h-7 text-sm leading-7"
// shrink-0: the rows are flex children of a `min-h-0 flex-1` nav, so an overflowing rail
// squeezed them below their own height instead of scrolling. The Sessions group owns the
// scrolling; every other row holds its size.
export const ROW_BASE = `relative box-border mb-1 flex ${ROW_HEIGHT} shrink-0 w-[calc(100%-16px)] mx-auto items-center gap-[10px] rounded-[6px] px-3 select-none`
export const ROW_INTERACTIVE = "cursor-pointer text-colorText hover:bg-colorFillSecondary"
// The rail's own selection tokens, not neutral fills: a raised pill with a hairline in both
// themes. The ring is inset rather than a border so the row's box never changes size
// between states.
export const ROW_SELECTED =
    "bg-[var(--ag-shell-selected-bg)] font-medium !text-[var(--ag-shell-selected-text)] shadow-[inset_0_0_0_1px_var(--ag-shell-selected-border)]"
