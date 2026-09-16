/**
 * Agent onboarding UI — the pre-create setup step (#6043).
 *
 * The rules (what gates create, what the created agent is told) live in
 * `@agenta/entities/workflow`; this layer renders them.
 */

export {default as AgentSetupCard, type AgentSetupCardProps} from "./AgentSetupCard"
export {default as AccountRow, type AccountRowProps} from "./AccountRow"
export {SETUP_COPY, setupBadge, setupFootnote, setupLead, setupTitle} from "./copy"
export {useAgentSetupStep, type AgentSetupDraft, type AgentSetupStep} from "./useAgentSetupStep"
