import {Compass} from "@phosphor-icons/react"

import {IconTile, type IconTileSize} from "../components/ui/icon-tile"

/** A skill's mark: one neutral tile with a light compass glyph, the same for every skill. */
export function SkillMark({size = 28}: {size?: IconTileSize}) {
    return (
        <IconTile size={size} tone="neutral" aria-hidden>
            <Compass weight="light" />
        </IconTile>
    )
}
