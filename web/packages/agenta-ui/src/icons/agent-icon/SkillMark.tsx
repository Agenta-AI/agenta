import {CompassIcon} from "@phosphor-icons/react"

import {IconTile, type IconTileSize} from "../../composed/layout/icon-tile"

/** A skill's mark: the neutral Mark with the Skill term icon (ICON-05). */
export function SkillMark({size = 24}: {size?: IconTileSize}) {
    return (
        <IconTile size={size} tone="neutral" aria-hidden>
            <CompassIcon />
        </IconTile>
    )
}
