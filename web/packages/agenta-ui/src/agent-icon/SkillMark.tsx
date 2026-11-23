import {CompassIcon} from "@phosphor-icons/react"

import {IconTile, type IconTileSize} from "../components/ui/icon-tile"

/** A skill's mark: the neutral Mark with the Skill term icon (DESIGN.md, icon per term). */
export function SkillMark({size = 24}: {size?: IconTileSize}) {
    return (
        <IconTile size={size} tone="neutral" aria-hidden>
            <CompassIcon />
        </IconTile>
    )
}
