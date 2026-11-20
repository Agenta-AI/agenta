import {FileText} from "@phosphor-icons/react"

import {InstructionsFileRow, type ItemRowStatus} from "../ItemRow"
import type {PanelSectionKey} from "../sectionChanges"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

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

    return (
        hasInstructions && {
            key: "instructions",
            icon: <FileText size={16} />,
            title: fieldTitle("instructions", t("entityUi.agentTemplate.instructions")),
            indicator: sectionIndicator("instructions"),
            defaultOpen: true,
            content: (
                <div className="flex flex-col gap-2">
                    <InstructionsFileRow
                        filename="AGENTS.md"
                        content={agentsMd ?? ""}
                        onOpen={openInstruction}
                        status={instructionsStatus}
                    />
                </div>
            ),
        }
    )
}
