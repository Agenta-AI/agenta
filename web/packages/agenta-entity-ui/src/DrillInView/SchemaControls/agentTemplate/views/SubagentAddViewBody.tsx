import {useCallback, useMemo} from "react"

import {useT} from "@agenta/i18n"
import addSubagentCatalog from "@agenta/i18n/catalogs/entityUi.addSubagent"
import {useDrillInUI, type WorkflowReferencePayload} from "@agenta/ui/drill-in"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {ConnectedAddSubagentList} from "../ConnectedSubagents"
import {savedSubagentSlugs} from "../SubagentAgent"
import {
    addSubagentReference,
    buildSubagentReference,
    removeSubagentSlug,
    toolsOf,
} from "../subagentReference"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {SubagentAddViewParams} from "./subagentAddView"

const SubagentAddViewBody = ({target}: ViewProps<SubagentAddViewParams>) => {
    const t = useT(addSubagentCatalog)
    useViewTitle(t("entityUi.addSubagent.addSubagents"))
    const {workflowReference} = useDrillInUI()
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const {update} = writer
    // Each write applies to the configuration as it is at write time, so a slow schema read
    // never replaces edits made meanwhile.
    const add = useCallback(
        async ({slug}: WorkflowReferencePayload) => {
            if (!workflowReference) return
            const reference = await buildSubagentReference(workflowReference, slug)
            update((agent) => ({...agent, tools: addSubagentReference(toolsOf(agent), reference)}))
        },
        [workflowReference, update],
    )
    const remove = useCallback(
        (slug: string) =>
            update((agent) => ({...agent, tools: removeSubagentSlug(toolsOf(agent), slug)})),
        [update],
    )
    // What the list marks as added, read from the saved tools rather than the list's state.
    const savedSlugs = useMemo(() => savedSubagentSlugs(toolsOf(writer.agent)), [writer.agent])
    if (!workflowReference?.enabled) return null
    return (
        <ConnectedAddSubagentList
            bridge={workflowReference}
            revisionId={writer.revisionId}
            savedSlugs={savedSlugs}
            onAdd={add}
            onRemoveSlug={remove}
        />
    )
}

export default SubagentAddViewBody
