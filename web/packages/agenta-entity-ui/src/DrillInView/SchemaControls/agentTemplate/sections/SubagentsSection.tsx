import {Robot} from "@phosphor-icons/react"

import {countSummary} from "../agentTemplateUtils"
import {SectionAddButton} from "../SectionAddButton"
import {ConnectedSubagentList} from "../SubagentDrawerContainer"
import {SubagentList, type SubagentListProps} from "../ToolManagementList"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

type WorkflowReferenceBridge = Parameters<typeof ConnectedSubagentList>[0]["bridge"]

export interface SubagentsSectionParams {
    t: AgentTemplateT
    hasTools: boolean
    sectionIndicator: SectionIndicatorFor
    disabled?: boolean
    /** Opens the subagent picker. Undefined when the host wires no workflow reference bridge. */
    openSubagentSelector: (() => void) | undefined
    subagentCount: number
    workflowReference: WorkflowReferenceBridge | undefined
    subagentTools: SubagentListProps["entries"]
    openEdit: SubagentListProps["openEdit"]
    removeItem: SubagentListProps["removeItem"]
    closeEditor: () => void
    toolStatusFor: SubagentListProps["statusFor"]
}

/** The agents this agent can call, saved as `{type: "reference"}` in the same `tools` array. */
export const subagentsSection = ({
    t,
    hasTools,
    sectionIndicator,
    disabled,
    openSubagentSelector,
    subagentCount,
    workflowReference,
    subagentTools,
    openEdit,
    removeItem,
    closeEditor,
    toolStatusFor,
}: SubagentsSectionParams): SectionResult => {
    // Shared by both subagent-list branches, which differ only by wrapper.
    const subagentListProps = {
        entries: subagentTools,
        openEdit,
        removeItem,
        closeEditor,
        disabled,
        statusFor: toolStatusFor,
    }

    return (
        hasTools &&
        (Boolean(openSubagentSelector) || subagentCount > 0) && {
            key: "subagents",
            icon: <Robot size={16} />,
            title: t("entityUi.agentTemplate.subagents"),
            summary: countSummary(subagentCount, "subagent"),
            indicator: sectionIndicator("subagents"),
            extra:
                !disabled && openSubagentSelector ? (
                    <SectionAddButton
                        label={t("entityUi.agentTemplate.addSubagent")}
                        onClick={openSubagentSelector}
                    />
                ) : undefined,
            defaultOpen: subagentCount > 0,
            // Only the connected list can resolve a reference's type and mark a non-agent.
            content: workflowReference?.enabled ? (
                <ConnectedSubagentList bridge={workflowReference} {...subagentListProps} />
            ) : (
                <SubagentList {...subagentListProps} />
            ),
        }
    )
}
