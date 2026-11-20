import {useCallback, useMemo, useRef} from "react"

import {useT} from "@agenta/i18n"
import addSubagentCatalog from "@agenta/i18n/catalogs/entityUi.addSubagent"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {ConnectedAddSubagentList} from "../ConnectedSubagents"
import {toolReferenceSlug} from "../itemDescriptors"
import {useAgentConfigWriter} from "../useAgentConfigWriter"
import {useAgentTools} from "../useAgentTools"

import type {SubagentAddViewParams} from "./subagentAddView"

const noCreate = () => undefined

const SubagentAddViewBody = ({target}: ViewProps<SubagentAddViewParams>) => {
    const t = useT(addSubagentCatalog)
    useViewTitle(t("entityUi.addSubagent.addSubagents"))
    const {workflowReference} = useDrillInUI()
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const configRef = useRef(writer.agent)
    configRef.current = writer.agent
    const onChange = useCallback(
        (next: Record<string, unknown>) => writer.update(() => next),
        [writer],
    )
    const {handleAddWorkflowReference, handleRemoveReferenceBySlug} = useAgentTools({
        config: writer.agent,
        onChange,
        configRef,
        openCreate: noCreate,
        workflowReference,
    })
    // What the list marks as added, read from the saved tools rather than the list's state.
    const savedSlugs = useMemo(
        () =>
            (Array.isArray(writer.agent.tools) ? (writer.agent.tools as unknown[]) : [])
                .map(toolReferenceSlug)
                .filter((slug): slug is string => Boolean(slug)),
        [writer.agent.tools],
    )
    if (!workflowReference?.enabled) return null
    return (
        <ConnectedAddSubagentList
            bridge={workflowReference}
            revisionId={writer.revisionId}
            savedSlugs={savedSlugs}
            onAdd={handleAddWorkflowReference}
            onRemoveSlug={handleRemoveReferenceBySlug}
        />
    )
}

export default SubagentAddViewBody
