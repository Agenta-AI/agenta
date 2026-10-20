import {AGENT_ICON_CHIP_CLASS, AgentIcon, agentIconChipStyle} from "@agenta/ui/agent-icon"
import {Robot} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

import type {OnboardingIconPick} from "./onboardingDraft"
import {useAgentGlyph} from "./useAgentGlyph"

/** The agent's face: its glyph on its colour's tint, as every agent surface draws it. */
export const OnboardingAgentChip = ({
    icon,
    size,
    className,
}: {
    icon: OnboardingIconPick
    size: number
    className?: string
}) => {
    const path = useAgentGlyph(icon.icon)
    return (
        <span
            aria-hidden
            className={cn(
                "flex shrink-0 items-center justify-center",
                AGENT_ICON_CHIP_CLASS,
                className,
            )}
            style={agentIconChipStyle(icon.color)}
        >
            {path ? <AgentIcon path={path} size={size} /> : <Robot size={size} />}
        </span>
    )
}
