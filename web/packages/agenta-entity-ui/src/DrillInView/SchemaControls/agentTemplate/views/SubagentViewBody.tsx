import {useState, type ReactNode} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import {useDrillInUI, type WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {ReferenceToolFormView} from "../../ReferenceToolFormView"
import {describeSubagent, toolReferenceSlug} from "../itemDescriptors"
import {SubagentRemoveDialog} from "../sections/SubagentsSection"
import {SubagentOpenAgentButton} from "../SubagentHeader"
import {findSubagentIndex, removeSubagentByRef, setSubagentDescription} from "../subagentReference"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {SubagentViewParams} from "./subagentView"

const toolsOf = (agent: Record<string, unknown>): unknown[] =>
    Array.isArray(agent.tools) ? (agent.tools as unknown[]) : []

/** The agent's CURRENT name, off its artifact, as the row shows it. */
const CurrentName = ({
    bridge,
    slug,
    fallback,
    children,
}: {
    bridge: WorkflowReferenceBridge
    slug: string
    fallback: string
    children: (name: string) => ReactNode
}) => {
    const {detail} = bridge.useSubagentDetail(slug)
    const name = useAtomValue(workflowMolecule.selectors.artifactName(detail?.workflowId ?? ""))
    return <>{children(name || fallback)}</>
}

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
    const index = findSubagentIndex(tools, params.item)
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
                tools: setSubagentDescription(toolsOf(agent), params.item, draft),
            }))
            return true
        },
    })

    if (!entry) {
        return (
            <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm">
                <ViewTitle title={params.item.key} />
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
            tools: removeSubagentByRef(toolsOf(agent), params.item),
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
            {writer.readOnly ? null : (
                <div className="shrink-0 px-4 py-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-colorError"
                        onClick={() => setConfirming(true)}
                    >
                        {t("entityUi.integrationViews.removeFromAgent")}
                    </Button>
                </div>
            )}
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
        <CurrentName bridge={workflowReference} slug={slug} fallback={fallbackTitle}>
            {content}
        </CurrentName>
    ) : (
        content(fallbackTitle)
    )
}

export default SubagentViewBody
