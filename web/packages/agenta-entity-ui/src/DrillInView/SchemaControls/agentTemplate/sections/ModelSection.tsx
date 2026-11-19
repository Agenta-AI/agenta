import type {AgentRequirementItem} from "@agenta/entities/workflow"
import {Cpu} from "@phosphor-icons/react"

import {ChangedPathsProvider, type ChangedPaths} from "../../../../drawers/shared"
import {modelIdFromConfig} from "../../connectionUtils"
import {NeedsSetupTag} from "../NeedsSetupTag"
import {needsSetupLabel, needsSetupReasonText} from "../needsSetupText"
import {SectionTitleBadge} from "../SectionTitleBadge"

import {ModelHarnessSectionBody, type ModelHarnessBodyProps} from "./ModelHarnessSectionBody"
import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

export interface ModelSectionParams {
    t: AgentTemplateT
    mh: ModelHarness
    sectionIndicator: SectionIndicatorFor
    config: Record<string, unknown>
    modelReq: AgentRequirementItem | undefined
    panelChangedPaths: ChangedPaths
    bodyProps: ModelHarnessBodyProps
}

/** The Model section: the connection list inline, and the needs-setup reason under it. */
export const modelSection = ({
    t,
    mh,
    sectionIndicator,
    config,
    modelReq,
    panelChangedPaths,
    bodyProps,
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
            icon: <Cpu size={16} />,
            title: t("entityUi.agentTemplate.model"),
            titleBadge: modelHarnessBadge,
            summary: mh.modelSummary,
            indicator: sectionIndicator("model-harness"),
            // A model that needs setup is the one thing that opens the section by itself; the list
            // holds the affordance that fixes it.
            defaultOpen: Boolean(modelReq),
            // The section EXPANDS (it carries no `onOpen`, which is what routes a header to a drawer
            // instead): the connection list renders right here. The drawer survives for the chat's
            // "connect a model" banner and for the Advanced section; it is just no longer where this
            // header leads.
            content: (
                <ChangedPathsProvider changes={panelChangedPaths}>
                    <ModelHarnessSectionBody section="model-harness" {...bodyProps} />
                    {modelReq ? (
                        <NeedsSetupTag
                            tag={false}
                            reason={needsSetupReasonText(modelReq.reason)}
                            className="mt-1"
                        />
                    ) : null}
                </ChangedPathsProvider>
            ),
        }
    )
}
