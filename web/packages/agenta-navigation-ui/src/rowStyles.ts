// leading-7: `truncate` clips to the line box, and a tighter one cuts descenders.
export const ROW_HEIGHT = "h-7 text-sm leading-7"
// shrink-0: only the Sessions group scrolls; every other row holds its height.
export const ROW_BASE = `relative box-border mb-1 flex ${ROW_HEIGHT} shrink-0 w-[calc(100%-16px)] mx-auto items-center gap-[10px] rounded-[6px] px-3 select-none`
// Icons sit a step quieter than the label and darken with the row.
export const ROW_INTERACTIVE =
    "cursor-pointer text-colorText hover:bg-colorFillSecondary [&_[data-row-icon]]:text-colorTextSecondary hover:[&_[data-row-icon]]:text-colorText"
// An inset ring, not a border, so the row's box never changes size between states.
export const ROW_SELECTED =
    "bg-[var(--ag-shell-selected-bg)] font-medium !text-[var(--ag-shell-selected-text)] shadow-[inset_0_0_0_1px_var(--ag-shell-selected-border)] [&_[data-row-icon]]:!text-[var(--ag-shell-selected-text)]"
