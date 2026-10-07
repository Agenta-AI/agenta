import type {AgentStarterTemplate} from "@agenta/entities/workflow"

import {cn} from "@/lib/utils"

import {OnboardingAgentChip} from "./OnboardingAgentChip"
import {templateGlyph} from "./onboardingChoices"

/** A template's face: its glyph on a tint of its catalog colour, the face its agent gets. */
export const OnboardingTemplateTile = ({
    template,
    size = "row",
}: {
    template: AgentStarterTemplate
    /** `row` in the gallery list; `panel` in the focused panel's header. */
    size?: "row" | "panel"
}) => (
    <OnboardingAgentChip
        icon={{icon: templateGlyph(template), color: template.color}}
        size={size === "row" ? 16 : 18}
        className={cn(
            "ring-foreground/5 ring-1 ring-inset",
            size === "row" ? "size-[34px] rounded-[9px]" : "size-8 rounded-lg",
        )}
    />
)
