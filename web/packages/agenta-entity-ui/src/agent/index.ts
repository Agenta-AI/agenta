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
export {
    AgentChip,
    AgentPicker,
    type AgentPickerProps,
    type AgentPickerDensity,
    type AgentPickerTriggerVariant,
} from "./AgentPicker"
export {NextTriggersSection, type NextTriggersSectionProps} from "./NextTriggersSection"
export {
    useUpcomingTriggers,
    type UpcomingTrigger,
    type UseUpcomingTriggersArgs,
} from "./useUpcomingTriggers"
export {
    AgentConfigSummaryCard,
    type AgentConfigSummaryCardProps,
    type AgentConfigSummaryCopy,
} from "./AgentConfigSummaryCard"
export {agentConfigSummary, prettifyKind, type AgentConfigSummary} from "./agentConfigSummary"
export {agentLatestRevisionAtomFamily} from "./state"
export {AgentCardGrid, type AgentCardGridProps} from "./AgentCardGrid"
export {AgentRosterGrid, type AgentRosterEntry, type AgentRosterGridProps} from "./AgentRosterGrid"
export {AgentOverviewLayout, type AgentOverviewLayoutProps} from "./AgentOverviewLayout"
export {AgentFilesCard} from "./AgentFilesCard"
export {AgentOverviewBody, type AgentOverviewBodyProps} from "./AgentOverviewBody"
export {AgentOverviewSkeleton} from "./AgentOverviewSkeleton"
export {AgentActionsMenu, type AgentActionsMenuProps} from "./AgentActionsMenu"
export {
    AgentNameInline,
    agentNameLabelClass,
    type AgentNameInlineProps,
    type AgentNameSize,
} from "./AgentNameInline"
export {AgentIconPopover} from "./AgentIconPopover"
export {AgentIdentity, type AgentIdentityProps, type AgentIdentitySize} from "./AgentIdentity"
export {AGENT_CHIP_BOX, AGENT_CHIP_FALLBACK, AGENT_FOCUS_RING} from "./chrome"
export {
    useAgentActions,
    useRenameAgent,
    useUpdateAgentDescription,
    type AgentActionTarget,
} from "./useAgentActions"
export {AgentIntroCard, capabilityLabel} from "./AgentIntroCard"
