// A rail row: 28px, 14px body text, 8px padding and gap: a 16px icon at 16–32px, its text at 40px.
export const ROW_HEIGHT = "h-row-dense text-body"
// shrink-0: only the Sessions group scrolls; every other row holds its height.
export const ROW_BASE = `relative box-border flex ${ROW_HEIGHT} shrink-0 w-[calc(100%-16px)] mx-auto items-center gap-2 rounded-md px-2 select-none`
export const ROW_INTERACTIVE = "cursor-pointer text-foreground hover:bg-accent"
// Opaque selected fill; the hover paints accent over it as an image.
export const ROW_SELECTED =
    "bg-selected text-foreground hover:bg-[image:linear-gradient(var(--accent),var(--accent))]"
/** The list of rail rows: 4px between rows (ROW-04). */
export const ROW_LIST = "flex flex-col gap-1"
