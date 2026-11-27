import {useState} from "react"

import {useDrillInUI} from "@agenta/editor/drill-in"
import {useT} from "@agenta/i18n"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import {useViewForm, useViewTitle, type ConfigItemRef, type ViewProps} from "@agenta/ui/view-stack"

import {ReferenceToolFormView} from "../../ReferenceToolFormView"
import {describeSubagent, toolReferenceSlug} from "../itemDescriptors"
import {savedSubagentSlugs, SubagentCurrentName, SubagentOpenAgentButton} from "../SubagentAgent"
import {
    findSubagentIndex,
    removeSubagentByRef,
    setSubagentDescription,
    uniqueSlugRef,
    toolsOf,
} from "../subagentReference"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import {RemovedItemState} from "./RemovedItemState"
import {RemoveFromAgentDialog} from "./RemoveFromAgentDialog"
import {RemoveFromAgentFooter} from "./RemoveFromAgentFooter"
import type {SubagentViewParams} from "./subagentView"

const ViewTitle = ({title}: {title: string}) => {
    useViewTitle(title)
    return null
}

/**
 * Edits a copy of the subagent's description. Save applies it to the agent configuration;
 * auto-save then saves the version. Cancel drops the copy. The subagent is found by its key in the
 * list as it is now, so a builder save that changes the list never puts another one here.
 */
const SubagentViewBody = ({params, target, nav}: ViewProps<SubagentViewParams>) => {
    const t = useT(subagentViewsCatalog)
    const {workflowReference} = useDrillInUI()
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const tools = toolsOf(writer.agent)
    // By its slug when unique: a write elsewhere can drop the copied `name` that keyed it.
    const [itemRef] = useState<ConfigItemRef>(() => {
        const opened = findSubagentIndex(tools, params.item)
        return (opened < 0 ? null : uniqueSlugRef(tools[opened], tools)) ?? params.item
    })
    const index = findSubagentIndex(tools, itemRef)
    const entry = index < 0 ? null : (tools[index] as Record<string, unknown>)
    // The text the view opened with. A builder save meanwhile does not reset the person's edits.
    const [original] = useState(() =>
        typeof entry?.description === "string" ? entry.description : "",
    )
    const [draft, setDraft] = useState(original)
    const [confirming, setConfirming] = useState(false)
    useViewForm({
        dirty: entry !== null && draft !== original,
        valid: entry !== null && !writer.readOnly,
        save: async () => {
            writer.update((agent) => ({
                ...agent,
                tools: setSubagentDescription(toolsOf(agent), itemRef, draft),
            }))
            return true
        },
    })

    if (!entry) {
        return (
            <>
                <ViewTitle title={params.item.key.replace(/^@slug:/, "")} />
                <RemovedItemState
                    message={t("entityUi.subagentViews.removedState")}
                    onBack={nav.cancel}
                />
            </>
        )
    }

    const slug = toolReferenceSlug(entry) ?? ""
    const fallbackTitle = describeSubagent(entry).name
    const remove = () => {
        setConfirming(false)
        writer.update((agent) => ({
            ...agent,
            tools: removeSubagentByRef(toolsOf(agent), itemRef),
        }))
        // The form belongs to the subagent that is gone: leave without asking.
        nav.cancel()
    }

    const content = (name: string) => (
        <div className="flex min-h-0 flex-1 flex-col">
            <ViewTitle title={name} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <ReferenceToolFormView
                    value={{...entry, description: draft}}
                    onChange={(next) =>
                        setDraft(typeof next.description === "string" ? next.description : "")
                    }
                    disabled={writer.readOnly}
                    name={name}
                    configurationAction={
                        workflowReference ? (
                            <SubagentOpenAgentButton bridge={workflowReference} slug={slug} />
                        ) : undefined
                    }
                />
            </div>
            {writer.readOnly ? null : <RemoveFromAgentFooter onClick={() => setConfirming(true)} />}
            <RemoveFromAgentDialog
                open={confirming}
                name={name}
                body={t("entityUi.subagentViews.agentStays")}
                onConfirm={remove}
                onCancel={() => setConfirming(false)}
            />
        </div>
    )
    return workflowReference ? (
        <SubagentCurrentName
            bridge={workflowReference}
            slug={slug}
            savedSlugs={savedSubagentSlugs(tools)}
            fallback={fallbackTitle}
        >
            {content}
        </SubagentCurrentName>
    ) : (
        content(fallbackTitle)
    )
}

export default SubagentViewBody
