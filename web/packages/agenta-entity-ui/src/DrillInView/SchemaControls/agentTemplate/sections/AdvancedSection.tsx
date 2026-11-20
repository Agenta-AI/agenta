import type {ReactNode} from "react"

import {SlidersHorizontal} from "@phosphor-icons/react"

import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

export interface AdvancedSectionParams {
    t: AgentTemplateT
    mh: ModelHarness
    sectionIndicator: SectionIndicatorFor
    /** The inline "what changed" body. Null when the section is clean. */
    advancedChangeBody: ReactNode
    /** Opens "Advanced" (F04 f9): the list of its parts. */
    openAdvanced: () => void
}

/** Advanced: a row that opens its view when clean, the changes not saved yet inline otherwise. */
export const advancedSection = ({
    t,
    mh,
    sectionIndicator,
    advancedChangeBody,
    openAdvanced,
}: AdvancedSectionParams): SectionResult =>
    mh.hasAdvanced && {
        key: "advanced",
        icon: <SlidersHorizontal size={16} />,
        title: t("entityUi.agentTemplate.advanced"),
        indicator: sectionIndicator("advanced"),
        // Never self-opening: nothing in Advanced blocks a run (see `needsProviderKeyInline`).
        defaultOpen: false,
        summary: mh.advancedSummary,
        // Changes not saved yet → show them inline (dropping `onOpen` is what expands a section).
        // Nothing changed → the row opens the view.
        ...(advancedChangeBody
            ? {content: advancedChangeBody}
            : {onOpen: openAdvanced, content: null}),
    }
