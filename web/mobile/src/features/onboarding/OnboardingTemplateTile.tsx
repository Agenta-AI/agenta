import type {AgentStarterTemplate} from "@agenta/entities/workflow"

import {cn} from "@/lib/utils"

/** A template's monogram on its catalog colour, the mark every template surface uses. */
export const OnboardingTemplateTile = ({
    template,
    large = false,
}: {
    template: AgentStarterTemplate
    large?: boolean
}) => (
    <span
        aria-hidden
        // The catalog colour is data, and its initials are white on every theme by contract.
        style={{backgroundColor: template.color}}
        className={cn(
            "flex shrink-0 items-center justify-center font-semibold text-white",
            large ? "size-12 rounded-xl text-base" : "size-9 rounded-[10px] text-xs",
        )}
    >
        {template.initials}
    </span>
)
