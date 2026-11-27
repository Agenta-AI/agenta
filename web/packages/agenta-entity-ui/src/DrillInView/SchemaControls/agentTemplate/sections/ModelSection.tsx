import type {AgentRequirementItem} from "@agenta/entities/workflow"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {Cpu} from "@phosphor-icons/react"

import {connectionFromConfig, modelIdFromConfig} from "../../connectionUtils"
import {needsSetupLabel} from "../needsSetupText"
import {SectionTitleBadge} from "../SectionTitleBadge"

import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

export interface ModelSectionParams {
    t: AgentTemplateT
    mh: ModelHarness
    sectionIndicator: SectionIndicatorFor
    config: Record<string, unknown>
    modelReq: AgentRequirementItem | undefined
    /** Opens the Model view. */
    openModel: () => void
}

/** The Model section: a row with the model, which opens the Model view. */
export const modelSection = ({
    t,
    mh,
    sectionIndicator,
    config,
    modelReq,
    openModel,
}: ModelSectionParams): SectionResult => {
    // The pill next to the Model section title. "No model" is client-side: with no model set the
    // server has nothing to check. Everything else is the server's needs-setup check.
    const modelHarnessBadge: React.ReactNode =
        mh.hasModelOrHarness && !modelIdFromConfig(config.llm) ? (
            <SectionTitleBadge label={t("entityUi.agentTemplate.noModel")} tone="error" />
        ) : modelReq ? (
            <SectionTitleBadge label={needsSetupLabel()} tone="warning" />
        ) : null

    // A model that is set up shows its provider's logo; with no model, or setup still needed,
    // the row keeps the chip.
    const modelId = modelIdFromConfig(config.llm)
    const provider =
        connectionFromConfig(config.llm).provider ??
        (modelId?.includes("/") ? modelId.split("/")[0] : null)
    const ProviderIcon =
        modelId && provider && !modelHarnessBadge ? getProviderIcon(provider) : null

    return (
        mh.hasModelOrHarness && {
            key: "model-harness",
            icon: ProviderIcon ? <ProviderIcon /> : <Cpu size={14} />,
            title: t("entityUi.agentTemplate.model"),
            // While setup is needed, the badge stands at the end of the row in place of the model.
            summary: modelHarnessBadge ?? mh.modelSummary,
            // The badge at the row's end already says it; no second warning dot on the icon.
            indicator: modelHarnessBadge ? undefined : sectionIndicator("model-harness"),
            defaultOpen: false,
            // The row opens the Model view, which holds today's list; a pick applies at once.
            onOpen: openModel,
            content: null,
        }
    )
}
