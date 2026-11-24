// leading-7: `truncate` clips to the line box, and a tighter one cuts descenders.
export const ROW_HEIGHT = "h-7 text-label leading-7"
// shrink-0: only the Sessions group scrolls; every other row holds its height.
export const ROW_BASE = `relative box-border mb-1 flex ${ROW_HEIGHT} shrink-0 w-[calc(100%-16px)] mx-auto items-center gap-[10px] rounded-sm px-3 select-none`
export const ROW_INTERACTIVE = "cursor-pointer text-foreground hover:bg-accent"
// An inset ring, not a border, so the row's box never changes size between states.
export const ROW_SELECTED =
    "bg-[var(--ag-shell-selected-bg)] hover:bg-[image:linear-gradient(var(--accent),var(--accent))] !text-[var(--ag-shell-selected-text)] shadow-[inset_0_0_0_1px_var(--ag-shell-selected-border)]"
