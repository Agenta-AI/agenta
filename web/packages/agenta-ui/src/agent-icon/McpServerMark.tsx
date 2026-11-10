import {HardDrives} from "@phosphor-icons/react"

import {IconTile, type IconTileSize} from "../components/ui/icon-tile"

/** An MCP server's mark: one neutral tile with a light server glyph, the same on every surface. */
export function McpServerMark({size = 28, className}: {size?: IconTileSize; className?: string}) {
    return (
        <IconTile size={size} tone="neutral" className={className} aria-hidden>
            <HardDrives weight="light" />
        </IconTile>
    )
}
