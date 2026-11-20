import {
    agentRequirementsAtomFamily,
    isPersonalRequirement,
    modelRequirement,
} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import agentTemplateCatalog from "@agenta/i18n/catalogs/entityUi.agentTemplate"
import {defineView, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import deepEqual from "fast-deep-equal"
import {useAtomValue, useStore} from "jotai"

import {ModelPickerLayoutContext} from "../modelPickerLayout"
import {NeedsSetupTag} from "../NeedsSetupTag"
import {needsSetupReasonText} from "../needsSetupText"
import {rememberModelPick} from "../rememberModelPick"
import {ModelHarnessSectionBody} from "../sections/ModelHarnessSectionBody"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

export type ModelViewParams = Record<string, never>

/**
 * The model list grouped by connection (F01 f2). A pick changes the agent configuration at once;
 * auto-save then saves the version, so the view has Done and no form.
 */
const ModelViewBody = ({target}: ViewProps<ModelViewParams>) => {
    const t = useT(agentTemplateCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const store = useStore()
    // The server's needs-setup check of the model; a personal requirement is each runner's own.
    const requirements = useAtomValue(agentRequirementsAtomFamily(writer.revisionId))
    const modelReq = modelRequirement(requirements?.filter((r) => !isPersonalRequirement(r)) ?? [])
    useViewTitle(t("entityUi.agentTemplate.model"))
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-3">
            {modelReq ? (
                <NeedsSetupTag tag={false} reason={needsSetupReasonText(modelReq.reason)} />
            ) : null}
            <ModelPickerLayoutContext.Provider value="list">
                <ModelHarnessSectionBody
                    section="model-harness"
                    schema={writer.schema}
                    config={writer.agent}
                    onChange={(next) => {
                        writer.update(() => next)
                        // A model or harness pick is remembered for the next agent, as the old
                        // Model drawer's Save did.
                        if (
                            !deepEqual(next.llm, writer.agent.llm) ||
                            !deepEqual(next.harness, writer.agent.harness)
                        )
                            rememberModelPick(store, next)
                    }}
                    disabled={writer.readOnly}
                    revisionId={writer.revisionId}
                    // A model the chosen key no longer offers: list only that key's models.
                    onlyCurrentConnection={modelReq?.kind === "model"}
                />
            </ModelPickerLayoutContext.Provider>
        </div>
    )
}

/** The Model pick (F01 f2). */
export const modelView = defineView<ModelViewParams>({
    id: "agent.model",
    apply: "immediate",
    Component: ModelViewBody,
})
