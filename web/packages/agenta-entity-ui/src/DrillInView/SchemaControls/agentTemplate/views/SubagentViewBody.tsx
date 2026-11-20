import {useState} from "react"

import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ConfigItemRef, type ViewProps} from "@agenta/ui/view-stack"

import {ReferenceToolFormView} from "../../ReferenceToolFormView"
import {describeSubagent, toolReferenceSlug} from "../itemDescriptors"
import {SubagentRemoveDialog} from "../sections/SubagentsSection"
import {savedSubagentSlugs, SubagentCurrentName, SubagentOpenAgentButton} from "../SubagentAgent"
import {
    findSubagentIndex,
    removeSubagentByRef,
    setSubagentDescription,
    subagentSlugRef,
    toolsOf,
} from "../subagentReference"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

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
    const t = useT(configItemsCatalog, integrationViewsCatalog, subagentViewsCatalog)
    const {workflowReference} = useDrillInUI()
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const tools = toolsOf(writer.agent)
    // A write made elsewhere can drop a legacy copied `name`, which changes the entry's key; the
    // view keeps finding its entry by the slug it opened on.
    const [openedSlug] = useState(() => {
        const opened = findSubagentIndex(tools, params.item)
        return opened < 0 ? undefined : toolReferenceSlug(tools[opened])
    })
    // The entry the view opened on, by its slug when it has one: a key can move to another
    // entry when writes elsewhere drop copied names.
    const itemRef: ConfigItemRef = openedSlug ? subagentSlugRef(openedSlug) : params.item
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
        leaveDescription: t("entityUi.configItems.saveOrDiscardDraft"),
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
            <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm">
                <ViewTitle title={params.item.key.replace(/^@slug:/, "")} />
                <span className="text-colorTextSecondary">
                    {t("entityUi.subagentViews.removedState")}
                </span>
                <Button variant="outline" size="sm" onClick={nav.cancel}>
                    {t("entityUi.integrationViews.back")}
                </Button>
            </div>
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
                    configurationAction={
                        workflowReference ? (
                            <SubagentOpenAgentButton bridge={workflowReference} slug={slug} />
                        ) : undefined
                    }
                />
            </div>
            {writer.readOnly ? null : <RemoveFromAgentFooter onClick={() => setConfirming(true)} />}
            {confirming ? (
                <SubagentRemoveDialog
                    name={name}
                    onRemove={remove}
                    onClose={() => setConfirming(false)}
                />
            ) : null}
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
