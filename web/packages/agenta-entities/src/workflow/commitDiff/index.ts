/**
 * Semantic commit-diff for agent/LLM workflows.
 *
 * Pure, dependency-light logic that turns two `parameters` objects into a
 * plain-language set of `ChangeSection`s (tools / instructions / model / params)
 * plus an auto commit message. Consumed by the commit modal's changes summary.
 */
export {readAgentConfig, PARAM_KEYS, stableStringify} from "./accessors"
export {agentItemIdentity, type AgentItemKind} from "./identity"
export {classifyAgentChanges} from "./classify"
export {buildCommitSummaryMessage} from "./summaryMessage"
export {parseGatewayToolName, type ParsedToolName} from "./gatewayName"
export type {
    AgentConfigView,
    NormalizedTool,
    ChangeSection,
    ChangeItem,
    ChangeTag,
    ChangeKind,
    SectionId,
    ScalarChange,
    TextDiff,
    ToolFieldChange,
} from "./types"
