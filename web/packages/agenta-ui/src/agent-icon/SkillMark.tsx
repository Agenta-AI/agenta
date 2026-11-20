import {BookOpenText} from "@phosphor-icons/react"

import {IconTile, type IconTileSize} from "../components/ui/icon-tile"

/**
 * The canvas skill mark (F04, F07): an orange tile with a white book, the same for every skill.
 * The palette has no token for this orange; the value is the canvas one, like the agent icon
 * colors in `colors.ts`.
 */
const SKILL_MARK_COLOR = "#c2410c"

/** The book is half the tile, as drawn (14 px in a 28 px tile). */
const GLYPH: Record<IconTileSize, number> = {24: 12, 28: 14, 32: 16, 44: 22}

/** A skill's mark: one orange tile with a white book glyph, the same for every skill. */
export function SkillMark({size = 28}: {size?: IconTileSize}) {
    return (
        <IconTile
            size={size}
            tone="neutral"
            aria-hidden
            style={{background: SKILL_MARK_COLOR, color: "#fff"}}
        >
            <BookOpenText weight="bold" style={{width: GLYPH[size], height: GLYPH[size]}} />
        </IconTile>
    )
}
