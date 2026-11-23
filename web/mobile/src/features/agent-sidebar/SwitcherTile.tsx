import {AgentChip} from "@agenta/entity-ui/agent"

/** `sm` in the switcher row, `md` in its panel and the collapsed rail, `lg` in the phone sheet. */
export type SwitcherTileSize = "sm" | "md" | "lg"

export const SWITCHER_TILE: Record<SwitcherTileSize, {box: string; glyph: number}> = {
    sm: {box: "size-5 !rounded", glyph: 12},
    md: {box: "size-6 !rounded-[6px]", glyph: 14},
    lg: {box: "size-8 !rounded-md", glyph: 18},
}

/** The agent's tile in the switcher: the app's one agent chip, at the switcher's sizes. */
export const SwitcherTile = ({agentId, size}: {agentId: string; size: SwitcherTileSize}) => (
    <AgentChip
        workflowId={agentId}
        box={SWITCHER_TILE[size].box}
        glyph={SWITCHER_TILE[size].glyph}
    />
)
