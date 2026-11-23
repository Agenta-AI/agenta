import {AgentChip} from "@agenta/entity-ui/agent"

/**
 * The switcher's tile sizes: `row` in the rail's switcher row (20 px, radius 4), `panel` in its
 * panel (24 px, radius 6, the project panel's avatar), `rail` in the collapsed rail (24 px),
 * `phone` in the phone sheet (32 px).
 */
export type SwitcherTileSize = "row" | "panel" | "rail" | "phone"

export const SWITCHER_TILE: Record<SwitcherTileSize, {box: string; glyph: number}> = {
    row: {box: "size-5 !rounded", glyph: 12},
    panel: {box: "size-6 !rounded-[6px]", glyph: 14},
    rail: {box: "size-6 !rounded-[6px]", glyph: 14},
    phone: {box: "size-8 !rounded-md", glyph: 18},
}

/** The agent's tile in the switcher: the app's one agent chip, at the switcher's sizes. */
export const SwitcherTile = ({agentId, size}: {agentId: string; size: SwitcherTileSize}) => (
    <AgentChip
        workflowId={agentId}
        box={SWITCHER_TILE[size].box}
        glyph={SWITCHER_TILE[size].glyph}
    />
)
