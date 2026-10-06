import {useEffect, useState} from "react"

import {
    AGENT_ICON_CHIP_CLASS,
    AGENT_ICON_COLORS,
    AgentIcon,
    agentIconChipStyle,
    loadAgentIconCatalog,
    type PhosphorCatalogEntry,
} from "@agenta/ui/agent-icon"
import {Robot} from "@phosphor-icons/react"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {ONBOARDING_COPY} from "./onboardingCopy"
import {DEFAULT_IDENTITY, type OnboardingIconPick} from "./onboardingDraft"

const GLYPHS = [
    "robot",
    "git-pull-request",
    "bug",
    "lightning",
    "shield-check",
    "chat-circle-dots",
    "megaphone",
    "chart-line-up",
]
const COLORS = AGENT_ICON_COLORS.slice(0, 8).map(([solid]) => solid)

/** The name-first agent's face: a glyph and a colour, saved onto the agent when it is created. */
export const OnboardingAgentIdentity = ({
    value,
    onChange,
}: {
    value: OnboardingIconPick | null
    onChange: (icon: OnboardingIconPick) => void
}) => {
    const [glyphs, setGlyphs] = useState<PhosphorCatalogEntry[]>([])
    useEffect(() => {
        let active = true
        void loadAgentIconCatalog()
            .then((items) => {
                if (active)
                    setGlyphs(GLYPHS.flatMap((name) => items.filter((item) => item.name === name)))
            })
            .catch(() => undefined)
        return () => {
            active = false
        }
    }, [])
    const {icon, color} = value ?? DEFAULT_IDENTITY
    const chosen = glyphs.find((item) => item.name === icon) ?? glyphs[0]

    return (
        <div className="flex flex-col items-center gap-4">
            <span
                className={cn(
                    "flex size-20 items-center justify-center rounded-[20px] lg:size-24 lg:rounded-[22px]",
                    AGENT_ICON_CHIP_CLASS,
                )}
                style={agentIconChipStyle(color)}
            >
                {chosen ? <AgentIcon path={chosen.path} size={44} /> : <Robot size={44} />}
            </span>
            <div className="flex flex-wrap justify-center gap-3">
                {COLORS.map((tone) => (
                    <button
                        type="button"
                        key={tone}
                        aria-label={ONBOARDING_COPY.agent.colorLabel(tone)}
                        aria-pressed={tone === color}
                        disabled={!chosen}
                        onClick={() => chosen && onChange({icon: chosen.name, color: tone})}
                        className={cn(
                            "border-background size-6 cursor-pointer rounded-full border-2 border-solid p-0 disabled:cursor-default",
                            FOCUS_RING,
                            tone === color && "outline-foreground outline-solid outline-2",
                        )}
                        style={{backgroundColor: tone}}
                    />
                ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
                {glyphs.map((glyph) => (
                    <button
                        type="button"
                        key={glyph.name}
                        aria-label={ONBOARDING_COPY.agent.iconLabel(glyph.name)}
                        aria-pressed={chosen?.name === glyph.name}
                        onClick={() => onChange({icon: glyph.name, color})}
                        className={cn(
                            "text-foreground flex size-9 cursor-pointer items-center justify-center rounded-lg border border-solid bg-transparent p-0",
                            FOCUS_RING,
                            chosen?.name === glyph.name
                                ? "border-foreground"
                                : "border-transparent",
                        )}
                    >
                        <AgentIcon path={glyph.path} size={20} />
                    </button>
                ))}
            </div>
        </div>
    )
}
