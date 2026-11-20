import {Broadcast} from "@phosphor-icons/react"

import {IconTile, type IconTileSize} from "../components/ui/icon-tile"

import {AGENT_ICON_COLORS} from "./colors"

/** One swatch per name, stable across renders and sessions: the same server keeps its color. */
function serverColor(name: string): string {
    let hash = 0
    for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return AGENT_ICON_COLORS[hash % AGENT_ICON_COLORS.length][0]
}

/**
 * An MCP server's mark (canvas F03): a colored tile with a white broadcast glyph. The color
 * comes from the server's name, from the agent icon swatches, so two servers in one list read
 * apart. With no name it is the neutral tile.
 */
export function McpServerMark({size = 28, name}: {size?: IconTileSize; name?: string | null}) {
    const named = !!name?.trim()
    return (
        <IconTile
            size={size}
            tone={named ? "solid" : "neutral"}
            style={named ? {background: serverColor(name as string)} : undefined}
            aria-hidden
        >
            <Broadcast weight={named ? "bold" : "regular"} />
        </IconTile>
    )
}
