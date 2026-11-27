import {useState} from "react"

import type {AgentaToolsMap} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import buildKitCatalog from "@agenta/i18n/catalogs/entityUi.buildKit"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import modelHarnessCatalog from "@agenta/i18n/catalogs/entityUi.modelHarness"
import {Button} from "@agenta/ui/ui"
import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import deepEqual from "fast-deep-equal"

import {ToolPermissionsSkeleton} from "../../DrawerSkeletons"
import {AgentaToolsSection, useAgentaToolsData, withAgentaTools} from "../AgentaToolsSection"
import {ADVANCED_PART_ICONS} from "../sections/AdvancedPartRows"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import {AdvancedPartHeader} from "./AdvancedPartHeader"
import type {AdvancedViewParams} from "./advancedViews"

/** Today's Agenta tools body. Save applies the form to the agent configuration; auto-save saves. */
const AgentaToolsViewBody = ({target}: ViewProps<AdvancedViewParams>) => {
    const t = useT(modelHarnessCatalog, configItemsCatalog, buildKitCatalog, commonCatalog)
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
        <div className="flex min-h-0 flex-1 flex-col">
            <AdvancedPartHeader
                icon={ADVANCED_PART_ICONS.agentaTools}
                title={t("entityUi.modelHarness.agentaTools")}
                description={
                    // The playground note is said once here, not on every row it touches.
                    Object.keys(data.access).some((op) => data.buildKitOps.has(op))
                        ? `${t("entityUi.buildKit.agentaToolsHint")} ${t("entityUi.buildKit.agentaToolsPlaygroundNote")}`
                        : t("entityUi.buildKit.agentaToolsHint")
                }
            />
            {data.status === "loading" ? (
                <ToolPermissionsSkeleton account="none" />
            ) : data.status === "error" ? (
                // What happened and the fix, in the permission list's place (STATE-03).
                <div className="flex flex-col items-start gap-3 px-4 py-4">
                    <span className="text-meta text-muted-foreground">
                        {t("entityUi.buildKit.couldNotLoadAgentaTools")}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => void data.retry()}>
                        {t("common.tryAgain")}
                    </Button>
                </div>
            ) : (
                <AgentaToolsSection
                    tools={shown}
                    onChange={setDraft}
                    access={data.access}
                    readOnly={writer.readOnly}
                />
            )}
        </div>
    )
}

export default AgentaToolsViewBody
