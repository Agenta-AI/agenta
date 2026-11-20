import type {AgentRequirementItem} from "@agenta/entities/workflow"
import {createT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {Cpu} from "@phosphor-icons/react"

import {modelIdFromConfig} from "../../connectionUtils"
import {needsSetupLabel} from "../needsSetupText"
import {SectionPageAction} from "../SectionPageAction"
import {SectionPageRow} from "../SectionPageRow"
import {SectionTitleBadge} from "../SectionTitleBadge"

import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

const tItems = createT(configItemsCatalog)

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

    return (
        mh.hasModelOrHarness && {
            key: "model-harness",
            icon: <Cpu size={14} />,
            title: t("entityUi.agentTemplate.model"),
            titleBadge: modelHarnessBadge,
            summary: mh.modelSummary,
            indicator: sectionIndicator("model-harness"),
            defaultOpen: false,
            // The row opens the Model view, which holds today's list; a pick applies at once.
            onOpen: openModel,
            pageAction: <SectionPageAction action="change" onClick={openModel} />,
            // The page card (canvas A04): the model's readable name, then its raw id and the
            // harness; "Change" opens the view, so the row has no caret.
            pageContent: (
                <SectionPageRow
                    icon={<Cpu size={14} />}
                    title={mh.modelCard.name ?? mh.modelCard.id ?? mh.modelSummary}
                    summary={<ModelCardLine {...mh.modelCard} />}
                />
            ),
            content: null,
        }
    )
}

/** The Model card's second line: the raw id in mono, then "via <harness>". */
const ModelCardLine = ({id, harness}: ModelHarness["modelCard"]) => {
    if (!id && !harness) return null
    return (
        <>
            {id ? <span className="font-mono">{id}</span> : null}
            {id && harness ? " · " : null}
            {harness ? tItems("entityUi.configItems.modelVia", {harness}) : null}
        </>
    )
}
