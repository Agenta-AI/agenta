import type {OwnerKind} from "@agenta/shared/types"
import {Badge} from "@agenta/ui/ui"

import {OWNER_ICON, useOwnerWord} from "./OwnerField"

/** Whose a row is, in a list that mixes owners: the owner's icon and word on a neutral badge (KIT-01). */
export const OwnerChip = ({owner}: {owner: OwnerKind}) => {
    const word = useOwnerWord()
    const Icon = OWNER_ICON[owner]
    return (
        <Badge icon={<Icon />} className="shrink-0">
            {word(owner)}
        </Badge>
    )
}
