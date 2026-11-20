/**
 * The phone shape of an automation row (M10): a flat row on the list with a divider, the name and
 * a line that wraps, the switch, and "⋯". Every control has a 44 px hit area.
 */
import {Switch} from "@agenta/ui/ui"

/**
 * The row frame on a phone: no card, at least 56 px high, and a divider under it that runs the
 * full width of the screen (the list's 16 px gutter moves inside the row).
 */
export const PHONE_ROW_CLASS =
    "-mx-4 flex min-h-14 items-center gap-3 border-0 border-b border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-surface-section-content)] py-1.5 pl-4 pr-2"

/** The name on a phone: 15 px, wraps instead of being cut. */
export const PHONE_NAME_CLASS = "break-words text-[15px] leading-5"

/** The automation line on a phone: wraps instead of being cut (phone-layout, "Long line"). */
export const PHONE_LINE_CLASS =
    "mt-0.5 break-words text-[12px] leading-4 text-[var(--ag-colorTextSecondary)]"

/**
 * The on/off switch of a row on a phone. It acts at once, as "Activate" and "Deactivate" do in
 * the row menu. The switch keeps its drawn size; an invisible area around it takes the tap.
 */
export function PhoneRowSwitch({
    name,
    active,
    onToggle,
}: {
    /** The automation's name: the switch's accessible name. */
    name: string
    active: boolean
    onToggle: (next: boolean) => void
}) {
    return (
        <Switch
            checked={active}
            onCheckedChange={onToggle}
            aria-label={name}
            onClick={(event) => event.stopPropagation()}
            // 44 x 26 with a 22 px thumb, as the canvas draws a phone switch.
            className="relative h-[26px] after:absolute after:-inset-x-1 after:-inset-y-[9px] after:content-[''] [&_[data-slot=switch-thumb]]:!size-[22px] data-[state=checked]:[&_[data-slot=switch-thumb]]:![transform:translateX(18px)]"
        />
    )
}
