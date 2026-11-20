import {useState} from "react"

import {useT} from "@agenta/i18n"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import type {ConfigItemRef} from "@agenta/ui/view-stack"
import {Robot} from "@phosphor-icons/react"

import {countSummary} from "../agentTemplateUtils"
import {ConnectedSubagentList} from "../ConnectedSubagents"
import {describeSubagent, toolReferenceSlug} from "../itemDescriptors"
import {RemoveFromAgentDialog} from "../RemoveFromAgentDialog"
import {SectionAddButton} from "../SectionAddButton"
import {savedSubagentSlugs, SubagentCurrentName} from "../SubagentAgent"
import {subagentItemRef} from "../subagentReference"
import {SubagentList, type SubagentListProps} from "../ToolManagementList"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

type WorkflowReferenceBridge = Parameters<typeof ConnectedSubagentList>[0]["bridge"]

export interface SubagentsSectionParams {
    t: AgentTemplateT
    hasTools: boolean
    sectionIndicator: SectionIndicatorFor
    disabled?: boolean
    /** Opens "Add subagents". Undefined when the host wires no workflow reference bridge. */
    openAddSubagents: (() => void) | undefined
    subagentCount: number
    workflowReference: WorkflowReferenceBridge | undefined
    subagentTools: SubagentListProps["entries"]
    /** Opens the subagent's view. */
    openSubagent: (item: ConfigItemRef) => void
    /** Removes the subagent from the agent, after the row bin's question. */
    removeSubagent: (item: ConfigItemRef) => void
    toolStatusFor: SubagentListProps["statusFor"]
}

/** The agents this agent can call, saved as `{type: "reference"}` in the same `tools` array. */
export const subagentsSection = ({
    t,
    hasTools,
    sectionIndicator,
    disabled,
    openAddSubagents,
    subagentCount,
    workflowReference,
    subagentTools,
    openSubagent,
    removeSubagent,
    toolStatusFor,
}: SubagentsSectionParams): SectionResult =>
    hasTools &&
    (Boolean(openAddSubagents) || subagentCount > 0) && {
        key: "subagents",
        icon: <Robot size={16} />,
        title: t("entityUi.agentTemplate.subagents"),
        summary: countSummary(subagentCount, "subagent"),
        indicator: sectionIndicator("subagents"),
        // Compact "+" for the header's `extra` slot. The header keeps a uniform height regardless of
        // this button: ConfigAccordionSection collapses the extra slot's vertical footprint (see its
        // `-my-2`), so no per-button sizing is needed here.
        extra:
            !disabled && openAddSubagents ? (
                <SectionAddButton
                    label={t("entityUi.agentTemplate.addSubagent")}
                    onClick={openAddSubagents}
                />
            ) : undefined,
        defaultOpen: subagentCount > 0,
        content: (
            <SubagentSectionBody
                entries={subagentTools}
                workflowReference={workflowReference}
                disabled={disabled}
                statusFor={toolStatusFor}
                openSubagent={openSubagent}
                removeSubagent={removeSubagent}
            />
        ),
    }

const noop = () => undefined

/** The saved subagents. A row opens its view; the row bin asks first (F06 f2). */
const SubagentSectionBody = ({
    entries,
    workflowReference,
    disabled,
    statusFor,
    openSubagent,
    removeSubagent,
}: {
    entries: SubagentListProps["entries"]
    workflowReference: WorkflowReferenceBridge | undefined
    disabled?: boolean
    statusFor: SubagentListProps["statusFor"]
    openSubagent: (item: ConfigItemRef) => void
    removeSubagent: (item: ConfigItemRef) => void
}) => {
    const [removing, setRemoving] = useState<{
        item: ConfigItemRef
        slug: string
        name: string
    } | null>(null)
    const subagentItems = entries.map(({item}) => item)
    const listProps: SubagentListProps = {
        entries,
        disabled,
        statusFor,
        closeEditor: noop,
        openEdit: (_kind, _index, tool) => {
            const item = subagentItemRef(tool, subagentItems)
            if (item) openSubagent(item)
        },
        removeItem: (_kind, index) => {
            const tool = entries.find((entry) => entry.index === index)?.item
            const item = subagentItemRef(tool, subagentItems)
            if (item)
                setRemoving({
                    item,
                    slug: toolReferenceSlug(tool) ?? "",
                    name: describeSubagent(tool).name,
                })
        },
    }
    const confirmRemove = () => {
        if (removing) removeSubagent(removing.item)
        setRemoving(null)
    }
    return (
        <>
            {/* Only the connected list can resolve a reference's type and mark a non-agent. */}
            {workflowReference?.enabled ? (
                <ConnectedSubagentList bridge={workflowReference} {...listProps} />
            ) : (
                <SubagentList {...listProps} />
            )}
            {removing ? (
                // The name the row shows: the agent's current name once it resolves.
                workflowReference ? (
                    <SubagentCurrentName
                        bridge={workflowReference}
                        slug={removing.slug}
                        savedSlugs={savedSubagentSlugs(subagentItems)}
                        fallback={removing.name}
                    >
                        {(name) => (
                            <SubagentRemoveDialog
                                name={name}
                                onRemove={confirmRemove}
                                onClose={() => setRemoving(null)}
                            />
                        )}
                    </SubagentCurrentName>
                ) : (
                    <SubagentRemoveDialog
                        name={removing.name}
                        onRemove={confirmRemove}
                        onClose={() => setRemoving(null)}
                    />
                )
            ) : null}
        </>
    )
}

/** "Remove {name} from this agent?" (F06 f2): the agent it calls stays in the project. */
export const SubagentRemoveDialog = ({
    name,
    onRemove,
    onClose,
}: {
    name: string
    onRemove: () => void
    onClose: () => void
}) => {
    const t = useT(subagentViewsCatalog)
    return (
        <RemoveFromAgentDialog
            open
            name={name}
            description={t("entityUi.subagentViews.agentStays")}
            onRemove={onRemove}
            onClose={onClose}
        />
    )
}
