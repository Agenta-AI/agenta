/**
 * Agent onboarding UI — the pre-create setup step (#6043).
 *
 * The rules (what gates create, what the created agent is told) live in
 * `@agenta/entities/workflow`; this layer renders them.
 */

export {default as AgentSetupCard, type AgentSetupCardProps} from "./AgentSetupCard"
export {default as AccountRow, type AccountRowProps} from "./AccountRow"
export {
    PERSONAL_SETUP_COPY,
    SETUP_COPY,
    setupBadge,
    setupFootnote,
    setupLead,
    setupTitle,
} from "./copy"
export {PersonalAccountsCard, type PersonalAccountsCardProps} from "./PersonalAccountsCard"
export {personalSetupItems, type PersonalSetupItem} from "./personalSetup"
export {SetupCardFrame, type SetupCardBadge, type SetupCardFrameProps} from "./SetupCardFrame"
export {useAgentSetupStep, type AgentSetupDraft, type AgentSetupStep} from "./useAgentSetupStep"
