import {IconTile} from "@agenta/ui/ui"
import {CalendarBlank, Lightning} from "@phosphor-icons/react"

import type {AutomationKind} from "./automationModel"

/** The 24px Mark of a pane's item title: the schedule or event glyph (ICON-05). */
export const AutomationKindTile = ({kind}: {kind: AutomationKind}) => (
    <IconTile size={24} aria-hidden>
        {kind === "event" ? <Lightning /> : <CalendarBlank />}
    </IconTile>
)
