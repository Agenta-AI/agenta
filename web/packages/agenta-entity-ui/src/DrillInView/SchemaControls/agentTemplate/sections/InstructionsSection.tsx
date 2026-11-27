import {createT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import itemDescriptorsCatalog from "@agenta/i18n/catalogs/entityUi.itemDescriptors"
import {FileText} from "@phosphor-icons/react"

import {mdPreview} from "../itemDescriptors"
import {InstructionsFileRow, StatusTag, type ItemRowStatus} from "../ItemRow"
import type {PanelSectionKey} from "../sectionChanges"

import type {AgentTemplateT, SectionIndicatorFor, SectionResult} from "./types"

const tItems = createT(configItemsCatalog, itemDescriptorsCatalog)
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
    const wordCount =
        words > 0
            ? tItems("entityUi.configItems.wordCount", {count: words})
            : tItems("entityUi.configItems.empty")
    const phoneSummary = `${FILENAME} · ${wordCount}`

    return (
        hasInstructions && {
            key: "instructions",
            icon: <FileText size={14} />,
            title: fieldTitle("instructions", t("entityUi.agentTemplate.instructions")),
            phoneSummary,
            indicator: sectionIndicator("instructions"),
            defaultOpen: true,
            insetBody: true,
            content: (
                <InstructionsFileRow
                    filename={FILENAME}
                    content={agentsMd ?? ""}
                    onOpen={openInstruction}
                    status={instructionsStatus}
                />
            ),
            panelCard: {
                onOpen: openInstruction,
                summary: words > 0 ? wordCount : undefined,
                badge: instructionsStatus ? <StatusTag status={instructionsStatus} /> : undefined,
                preview:
                    words > 0 ? (
                        <span className="line-clamp-3 text-meta text-foreground">
                            {mdPreview(agentsMd ?? "", 320)}
                        </span>
                    ) : (
                        <span className="text-meta text-muted-foreground">
                            {tItems("entityUi.itemDescriptors.emptyFile")}
                        </span>
                    ),
            },
        }
    )
}
