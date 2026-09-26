import {useAgentIconChrome} from "@agenta/entity-ui/agent"
import {Robot} from "@phosphor-icons/react"

export interface AgentMarkProps {
    agentId?: string
    /** The tile's edge, in px. */
    size?: number
    /** The glyph's edge, in px. */
    glyph?: number
    className?: string
}

/** An agent's own icon on its tile; the robot glyph when the agent has none. */
export const AgentMark = ({agentId, size = 32, glyph = 16, className = ""}: AgentMarkProps) => {
    const chrome = useAgentIconChrome(agentId, {size: glyph, fallbackGlyph: <Robot size={glyph} />})
    return (
        <span
            className={`flex flex-none items-center justify-center rounded-lg ${
                chrome.customised
                    ? chrome.className
                    : "border border-solid border-border bg-background text-muted-foreground"
            } ${className}`}
            style={{...chrome.style, width: size, height: size}}
        >
            {chrome.glyph}
        </span>
    )
}
