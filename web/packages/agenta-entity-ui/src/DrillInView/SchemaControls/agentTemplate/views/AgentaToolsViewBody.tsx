import {useState} from "react"

import type {AgentaToolsMap} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import buildKitCatalog from "@agenta/i18n/catalogs/entityUi.buildKit"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import deepEqual from "fast-deep-equal"

import {AgentaToolsSection, useAgentaToolsData, withAgentaTools} from "../AgentaToolsSection"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {AdvancedViewParams} from "./advancedViews"

/** Today's Agenta tools body. Save applies the form to the agent configuration; auto-save saves. */
const AgentaToolsViewBody = ({target}: ViewProps<AdvancedViewParams>) => {
    const t = useT(modelHarnessCatalog, configItemsCatalog, buildKitCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const data = useAgentaToolsData(writer.agent, writer.revisionId)
    // The form starts from the agent's entry; edits stay here until Save.
    const [draft, setDraft] = useState<AgentaToolsMap | null>(null)
    const shown = draft ?? data.tools
    useViewTitle(t("entityUi.modelHarness.agentaTools"))
    useViewForm({
        dirty: draft !== null && !deepEqual(draft, data.tools),
        valid: !writer.readOnly,
        save: async () => {
            if (writer.readOnly) return false
            if (draft) writer.update((agent) => withAgentaTools(agent, draft))
            return true
        },
        leaveDescription: t("entityUi.configItems.saveOrDiscardDraft"),
    })

    return (
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            {data.status === "error" ? (
                <span className="text-xs text-colorError">
                    {t("entityUi.buildKit.couldNotLoadAgentaTools")}
                </span>
            ) : data.status === "ready" ? (
                <AgentaToolsSection
                    tools={shown}
                    onChange={setDraft}
                    access={data.access}
                    buildKitOps={data.buildKitOps}
                    readOnly={writer.readOnly}
                />
            ) : null}
        </div>
    )
}

export default AgentaToolsViewBody
