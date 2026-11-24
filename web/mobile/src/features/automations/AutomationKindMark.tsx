import {automationTypeLabel, useAutomationText, type Automation} from "@agenta/automation-ui"
import {CalendarBlank, Lightning} from "@phosphor-icons/react"

/**
 * An automation's mark: a tile, like the agent's beside it, so the two marks on a row read as
 * the same kind of thing. Neutral like every Mark (COLOR-05); the glyph says the kind.
 *
 * Named for a screen reader: on a phone the row drops its Runs-when cell, so this tile is the
 * only thing on the row that says which kind it is.
 */
/** 24 in one-line rows and cards; 32 in two-line (48px) rows. */
export const AutomationKindMark = ({
    kind,
    size = 24,
}: {
    kind: Automation["kind"]
    size?: 24 | 32
}) => {
    useAutomationText()
    return (
        <span
            role="img"
            aria-label={automationTypeLabel(kind)}
            className={`flex ${size === 32 ? "size-8" : "size-6"} shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground`}
        >
            {kind === "event" ? (
                <Lightning size={size === 32 ? 16 : 14} aria-hidden />
            ) : (
                <CalendarBlank size={size === 32 ? 16 : 14} aria-hidden />
            )}
        </span>
    )
}
