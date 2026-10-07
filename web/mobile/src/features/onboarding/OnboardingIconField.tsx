import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import dynamic from "next/dynamic"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {OnboardingAgentChip} from "./OnboardingAgentChip"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {BLANK_AGENT, type OnboardingIconPick} from "./onboardingDraft"
import {useAgentGlyph} from "./useAgentGlyph"

// The picker carries the virtualizer and the icon catalog; it loads only once opened.
const AgentIconPicker = dynamic(
    () => import("@agenta/ui/agent-icon").then((mod) => mod.AgentIconPicker),
    {ssr: false},
)

/** The agent's glyph and colour, picked in the same panel every agent surface uses. */
export const OnboardingIconField = ({
    value,
    onChange,
}: {
    value: OnboardingIconPick
    onChange: (icon: OnboardingIconPick) => void
}) => {
    const path = useAgentGlyph(value.icon)
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={ONBOARDING_COPY.creator.changeIcon}
                    className={cn(
                        "border-border bg-background hover:bg-accent flex w-fit cursor-pointer items-center gap-3 rounded-xl border border-solid p-1.5 pr-3",
                        FOCUS_RING,
                    )}
                >
                    <OnboardingAgentChip icon={value} size={22} className="size-10 rounded-[10px]" />
                    <span className="text-muted-foreground text-sm">
                        {ONBOARDING_COPY.creator.changeIcon}
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                collisionPadding={12}
                className="max-h-[var(--radix-popover-content-available-height)] w-auto overflow-y-auto p-0"
            >
                <AgentIconPicker
                    value={path ? {...value, path} : null}
                    onChange={(next) =>
                        onChange(next ? {icon: next.icon, color: next.color} : BLANK_AGENT.icon)
                    }
                />
            </PopoverContent>
        </Popover>
    )
}
