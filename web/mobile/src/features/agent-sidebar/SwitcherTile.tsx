import {useAgentIconChrome} from "@agenta/entity-ui/agent"
import {Bot} from "lucide-react"

/**
 * The switcher's tile sizes: `row` in the rail's switcher row and its menu (20 px, radius 4),
 * `rail` in the collapsed rail (24 px, radius 6), `phone` in the phone sheet (32 px, radius 6).
 */
export type SwitcherTileSize = "row" | "rail" | "phone"

export const SWITCHER_TILE: Record<SwitcherTileSize, {box: string; glyph: number}> = {
    row: {box: "size-5 rounded", glyph: 12},
    rail: {box: "size-6 rounded-md", glyph: 14},
    phone: {box: "size-8 rounded-md", glyph: 18},
}

/**
 * The agent's tile in the switcher. An agent with no icon of its own gets the agent type's blue
 * tint, as the design draws it.
 */
export const SwitcherTile = ({agentId, size}: {agentId: string; size: SwitcherTileSize}) => {
    const {box, glyph} = SWITCHER_TILE[size]
    const chrome = useAgentIconChrome(agentId, {
        size: glyph,
        // The canvas draws an outline robot (Lucide); Phosphor's robot has a filled face.
        fallbackGlyph: <Bot aria-hidden size={glyph} />,
    })
    return (
        <span
            className={`flex shrink-0 items-center justify-center ${box} ${
                chrome.customised
                    ? chrome.className
                    : "bg-[var(--ag-type-agent-bg)] text-[var(--ag-type-agent-text)]"
            }`}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}
