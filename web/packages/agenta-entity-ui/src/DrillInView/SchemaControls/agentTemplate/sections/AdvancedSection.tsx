import type {ReactNode} from "react"

import type {ViewDef} from "@agenta/ui/view-stack"
import {GearSix} from "@phosphor-icons/react"

import {advancedView, type AdvancedViewParams} from "../views/advancedViews"

import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

export interface AdvancedSectionParams {
    t: AgentTemplateT
    mh: ModelHarness
    sectionIndicator: SectionIndicatorFor
    /** The inline "what changed" body. Null when the section is clean. */
    advancedChangeBody: ReactNode
    /** Opens "Advanced" (F04 f9, the list of its parts) or one part's view. */
    openAdvanced: (view: ViewDef<AdvancedViewParams>) => void
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
        icon: <GearSix size={14} />,
        title: t("entityUi.agentTemplate.advanced"),
        indicator: sectionIndicator("advanced"),
        // Never self-opening: nothing in Advanced blocks a run (see `needsProviderKeyInline`).
        defaultOpen: false,
        // The agent's sandbox (canvas F01, M07: "Sandbox: Daytona"); the view lists the parts.
        summary: mh.sandboxSummary,
        // A view opens, but the row ends with the triangle of the rows around it (canvas F01).
        drawerAffordance: "triangle",
        // Changes not saved yet → show them inline (dropping `onOpen` is what expands a section).
        // Nothing changed → the row opens the view.
        ...(advancedChangeBody
            ? {content: advancedChangeBody}
            : {onOpen: () => openAdvanced(advancedView), content: null}),
    }
