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

import {NeedsSetupTag} from "../NeedsSetupTag"
import {needsSetupReasonText} from "../needsSetupText"
import {rememberModelPick} from "../rememberModelPick"
import {ModelHarnessSectionBody} from "../sections/ModelHarnessSectionBody"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

export interface ModelViewParams {
    readOnly?: boolean
}

/**
 * Today's model list. A pick changes the agent configuration at once; auto-save then saves the
 * version, so the view has Done and no form.
 */
const ModelViewBody = ({params, target}: ViewProps<ModelViewParams>) => {
    const t = useT(agentTemplateCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const store = useStore()
    // The server's needs-setup check of the model; a personal requirement is each runner's own.
    const requirements = useAtomValue(agentRequirementsAtomFamily(writer.revisionId))
    const modelReq = modelRequirement(requirements?.filter((r) => !isPersonalRequirement(r)) ?? [])
    useViewTitle(t("entityUi.agentTemplate.model"))
    return (
        <div className="flex flex-col gap-2 px-4 py-3">
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
                disabled={params.readOnly}
                revisionId={writer.revisionId}
                // A model the chosen key no longer offers: list only that key's models.
                onlyCurrentConnection={modelReq?.kind === "model"}
            />
            {modelReq ? (
                <NeedsSetupTag tag={false} reason={needsSetupReasonText(modelReq.reason)} />
            ) : null}
        </div>
    )
}

/** The Model pick (F01 f2). The model providers milestones redraw the list. */
export const modelView = defineView<ModelViewParams>({
    id: "agent.model",
    apply: "immediate",
    Component: ModelViewBody,
})
