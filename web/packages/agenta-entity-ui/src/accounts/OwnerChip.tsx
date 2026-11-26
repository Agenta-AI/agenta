import type {OwnerKind} from "@agenta/shared/types"
import {Badge, cn} from "@agenta/ui/ui"

import {OWNER_ICON, useOwnerWord} from "./OwnerField"

/** Each owner a data color (COLOR-05); data-4, not the amber data-3, so no chip reads as a warning. */
const OWNER_TONE: Record<OwnerKind, string> = {
    user: "bg-data-1/15 text-data-1",
    project: "bg-data-2/15 text-data-2",
    organization: "bg-data-4/15 text-data-4",
}

/** Whose a row is, in a list that mixes owners (the All tab): icon and word. */
export const OwnerChip = ({owner}: {owner: OwnerKind}) => {
    const word = useOwnerWord()
    const Icon = OWNER_ICON[owner]
    return (
        <Badge icon={<Icon />} className={cn("shrink-0", OWNER_TONE[owner])}>
            {word(owner)}
        </Badge>
    )
}
