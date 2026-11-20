import {createT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {FileText} from "@phosphor-icons/react"

import {InstructionsFileRow, type ItemRowStatus} from "../ItemRow"
import type {PanelSectionKey} from "../sectionChanges"
import {SectionPageAction} from "../SectionPageAction"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

const tItems = createT(configItemsCatalog)
const FILENAME = "AGENTS.md"

export interface InstructionsSectionParams {
    t: AgentTemplateT
    hasInstructions: boolean
    fieldTitle: (field: string, fallback: string) => string
    sectionIndicator: SectionIndicatorFor
    draftSectionKeys: ReadonlySet<PanelSectionKey>
    agentsMd: string | null
    /** Opens the AGENTS.md editor view. */
    openInstruction: () => void
}

/** The Instructions section: one row per instruction file (AGENTS.md today). */
export const instructionsSection = ({
    t,
    hasInstructions,
    fieldTitle,
    sectionIndicator,
    draftSectionKeys,
    agentsMd,
    openInstruction,
}: InstructionsSectionParams): SectionResult => {
    const instructionsStatus: ItemRowStatus | undefined = draftSectionKeys.has("instructions")
        ? {
              tone: "edited",
              label: t("entityUi.agentTemplate.edited"),
              tooltip: t("entityUi.agentTemplate.editedNotSaved"),
          }
        : undefined
    // Counted as the file row inside counts them.
    const words = (agentsMd ?? "").trim().split(/\s+/).filter(Boolean).length
    const phoneSummary = `${FILENAME} · ${
        words > 0
            ? tItems("entityUi.configItems.wordCount", {count: words})
            : tItems("entityUi.configItems.empty")
    }`

    return (
        hasInstructions && {
            key: "instructions",
            icon: <FileText size={16} />,
            title: fieldTitle("instructions", t("entityUi.agentTemplate.instructions")),
            phoneSummary,
            indicator: sectionIndicator("instructions"),
            defaultOpen: true,
            pageAction: <SectionPageAction action="edit" onClick={openInstruction} />,
            content: (
                <div className="flex flex-col gap-2">
                    <InstructionsFileRow
                        filename={FILENAME}
                        content={agentsMd ?? ""}
                        onOpen={openInstruction}
                        status={instructionsStatus}
                    />
                </div>
            ),
        }
    )
}
