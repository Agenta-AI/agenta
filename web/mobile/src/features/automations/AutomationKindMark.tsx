import {AUTOMATION_TYPE_LABEL, type Automation} from "@agenta/automation-ui"
import {ClockClockwise, Lightning} from "@phosphor-icons/react"

/** The kind mark's tile. Preset pairs, so both halves flip with the theme. */
const KIND_CHIP: Record<Automation["kind"], string> = {
    event: "bg-[var(--ag-preset-orange-bg)] text-[var(--ag-preset-orange-text)]",
    schedule: "bg-[var(--ag-preset-purple-bg)] text-[var(--ag-preset-purple-text)]",
}

/**
 * An automation's mark: a tile, like the agent's beside it, so the two marks on a row read as
 * the same kind of thing. The two kinds get their own tint: at a glance down a column, colour
 * separates "when something happens" from "on a schedule" faster than two small glyphs do.
 *
 * Named for a screen reader: on a phone the row drops its Runs-when cell, so this tile is the
 * only thing on the row that says which kind it is.
 */
export const AutomationKindMark = ({kind}: {kind: Automation["kind"]}) => (
    <span
        role="img"
        aria-label={AUTOMATION_TYPE_LABEL[kind]}
        className={`flex size-7 shrink-0 items-center justify-center rounded-md ${KIND_CHIP[kind]}`}
    >
        {kind === "event" ? (
            <Lightning size={15} aria-hidden />
        ) : (
            <ClockClockwise size={15} aria-hidden />
        )}
    </span>
)
