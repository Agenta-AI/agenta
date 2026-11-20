import {useAgentIconChrome} from "@agenta/entity-ui/agent"
import {RobotIcon} from "@phosphor-icons/react"

/**
 * The agent's tile in the switcher: 32 px, radius 8, with an 18 px glyph (`small`: the menu's
 * 22 px, radius 5, 14 px glyph). An agent with no icon of its own gets the agent type's blue
 * tint, as the design draws it.
 */
export const SwitcherTile = ({agentId, small = false}: {agentId: string; small?: boolean}) => {
    const glyph = small ? 14 : 18
    const chrome = useAgentIconChrome(agentId, {
        size: glyph,
        fallbackGlyph: <RobotIcon aria-hidden size={glyph} />,
    })
    return (
        <span
            className={`flex shrink-0 items-center justify-center ${small ? "size-[22px] rounded-[5px]" : "size-8 rounded-md"} ${
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
