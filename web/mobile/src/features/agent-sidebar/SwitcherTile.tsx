import {useAgentIconChrome} from "@agenta/entity-ui/agent"
import {RobotIcon} from "@phosphor-icons/react"

/**
 * The agent's tile in the switcher: 32 px, radius 8, with an 18 px glyph. An agent with no icon of
 * its own gets the agent type's blue tint, as the design draws it.
 */
export const SwitcherTile = ({agentId}: {agentId: string}) => {
    const chrome = useAgentIconChrome(agentId, {
        size: 18,
        fallbackGlyph: <RobotIcon aria-hidden size={18} />,
    })
    return (
        <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                chrome.customised
                    ? chrome.className
                    : "bg-[var(--ag-type-agent-bg)] text-[var(--ag-type-agent-text)]"
            }`}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}
