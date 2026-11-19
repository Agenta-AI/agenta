import type {ReactNode} from "react"

import type {AgentRequirementItem} from "@agenta/entities/workflow"
import {SlidersHorizontal} from "@phosphor-icons/react"

import {needsSetupLabel} from "../needsSetupText"
import {SectionTitleBadge} from "../SectionTitleBadge"

import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

export interface AdvancedSectionParams {
    t: AgentTemplateT
    mh: ModelHarness
    sectionIndicator: SectionIndicatorFor
    secretReq: AgentRequirementItem | undefined
    /** The inline "what changed" body. Null when the section is clean. */
    advancedChangeBody: ReactNode
    openSectionDrawer: (key: "model-harness" | "advanced") => void
}

/** Advanced: a drawer row when clean, the uncommitted changes inline otherwise. */
export const advancedSection = ({
    t,
    mh,
    sectionIndicator,
    secretReq,
    advancedChangeBody,
    openSectionDrawer,
}: AdvancedSectionParams): SectionResult => {
    const advancedBadge: ReactNode = secretReq ? (
        <SectionTitleBadge label={needsSetupLabel()} tone="warning" />
    ) : null

    return (
        mh.hasAdvanced && {
            key: "advanced",
            icon: <SlidersHorizontal size={16} />,
            title: t("entityUi.agentTemplate.advanced"),
            titleBadge: advancedBadge,
            indicator: sectionIndicator("advanced"),
            // Never self-opening: nothing in Advanced blocks a run (see `needsProviderKeyInline`).
            defaultOpen: false,
            summary: mh.advancedSummary,
            // Uncommitted changes → show them inline (dropping `onOpen` is what expands a section
            // instead of routing to the drawer). Nothing changed → the plain drawer row.
            ...(advancedChangeBody
                ? {content: advancedChangeBody}
                : {
                      onOpen: () => openSectionDrawer("advanced"),
                      content: mh.advancedDrawerBody,
                  }),
        }
    )
}
