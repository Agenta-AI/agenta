import {HardDrivesIcon} from "@phosphor-icons/react"

import {IconTile, type IconTileSize} from "../components/composed/icon-tile"

/** An MCP server's mark: the neutral Mark with the MCP term icon (ICON-05). */
export function McpServerMark({size = 24}: {size?: IconTileSize; name?: string | null}) {
    return (
        <IconTile size={size} tone="neutral" aria-hidden>
            <HardDrivesIcon />
        </IconTile>
    )
}
