import type {OwnerKind} from "@agenta/shared/types"
import {Badge} from "@agenta/ui/ui"

import {OWNER_ICON, useOwnerWord} from "./OwnerField"

/** Whose a row is, in a list that mixes owners (the All tab): icon and word. */
export const OwnerChip = ({owner}: {owner: OwnerKind}) => {
    const word = useOwnerWord()
    const Icon = OWNER_ICON[owner]
    return (
        <Badge icon={<Icon aria-hidden />} className="shrink-0">
            {word(owner)}
        </Badge>
    )
}
