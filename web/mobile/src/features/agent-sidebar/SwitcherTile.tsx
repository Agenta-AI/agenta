import {AgentChip} from "@agenta/entity-ui/agent"

/** 16 in the switcher row (a rail row), 20 in its panel (a picker). */
export type SwitcherTileSize = 16 | 20

/** The agent's Mark in the switcher: the app's one agent Mark, at the switcher's sizes. */
export const SwitcherTile = ({agentId, size}: {agentId: string; size: SwitcherTileSize}) => (
    <AgentChip workflowId={agentId} size={size} />
)
