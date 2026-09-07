/**
 * Agent surfaces — antd-free (eslint-enforced for this directory), so mobile can adopt them.
 * Data-connected cells (activity, owner) and the classified agents list stay app-side and
 * arrive as slots/props; the components own only what an agent card or trigger row IS.
 */
export {AgentChatAvatar, type AgentChatAvatarProps} from "./AgentChatAvatar"
export {
    AgentGlyph,
    useAgentIconChrome,
    useAgentIconRecord,
    type AgentGlyphProps,
    type AgentIconChrome,
} from "./agentIcon"
export {AgentCard, agentAvatar, type AgentCardData, type AgentCardProps} from "./AgentCard"
export {NextTriggersSection, type NextTriggersSectionProps} from "./NextTriggersSection"
export {AgentConfigSummaryCard, type AgentConfigSummaryCardProps} from "./AgentConfigSummaryCard"
export {agentConfigSummary, prettifyKind, type AgentConfigSummary} from "./agentConfigSummary"
export {agentLatestRevisionAtomFamily} from "./state"
export {AgentCardGrid, type AgentCardGridProps} from "./AgentCardGrid"
export {AgentRosterGrid, type AgentRosterEntry, type AgentRosterGridProps} from "./AgentRosterGrid"
export {AgentOverviewLayout, type AgentOverviewLayoutProps} from "./AgentOverviewLayout"
export {AgentFilesCard} from "./AgentFilesCard"
export {AgentOverviewBody, type AgentOverviewBodyProps} from "./AgentOverviewBody"
export {AgentOverviewSkeleton} from "./AgentOverviewSkeleton"
export {AgentActionsMenu, type AgentActionsMenuProps} from "./AgentActionsMenu"
export {useAgentActions, type AgentActionTarget} from "./useAgentActions"
export {AgentIntroCard, capabilityLabel} from "./AgentIntroCard"
