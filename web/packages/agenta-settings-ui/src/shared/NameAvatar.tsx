import {AGENT_ICON_CHIP_CLASS, AGENT_ICON_COLORS, agentIconChipStyle} from "@agenta/ui/agent-icon"
import {cn} from "@agenta/ui/ui"

/** A stable palette pick per name, so a row keeps its colour across renders and visits. */
const colorFor = (name: string) => {
    let hash = 0
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return AGENT_ICON_COLORS[Math.abs(hash) % AGENT_ICON_COLORS.length][0]
}

/** A name's initial on the soft tint agents use, at the row tile's size and corners. */
export const NameAvatar = ({name, className}: {name: string; className?: string}) => (
    <span
        aria-hidden
        style={agentIconChipStyle(colorFor(name || "?"))}
        className={cn(
            "inline-flex size-7 shrink-0 select-none items-center justify-center rounded-[6px] text-[13px] font-semibold uppercase",
            AGENT_ICON_CHIP_CLASS,
            className,
        )}
    >
        {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
)
