/**
 * The one row every menu-like list renders: DropdownMenu, ContextMenu, Select, Combobox and
 * Command items. 32px tall, 8px side padding, a 16px icon 8px from the text (ROW-02, SPACE-03).
 * The same size on every screen.
 */
export const MENU_ITEM = [
    "relative box-border flex min-h-8 w-full cursor-pointer select-none items-center gap-2 outline-none",
    "rounded-sm px-2 py-1 text-label",
    // `accent`, not `muted`: in dark `--muted` equals the panel's own background.
    "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
    // cmdk writes data-disabled="false" on every enabled row, so presence alone is not enough.
    "[&[data-disabled]:not([data-disabled=false])]:pointer-events-none [&[data-disabled]:not([data-disabled=false])]:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
].join(" ")

/** Left padding for an item with an indicator or an inset label: 8 + 16 icon + 8 gap. */
export const MENU_ITEM_INSET = "pl-8"
