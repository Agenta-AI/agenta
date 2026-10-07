import {
    AGENT_ICON_CHIP_CLASS,
    AGENT_ICON_COLORS,
    AgentIcon,
    agentIconChipStyle,
} from "@agenta/ui/agent-icon"
import {Input} from "@agenta/ui/ui"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {OnboardingAgentChip} from "./OnboardingAgentChip"
import {FIRST_MESSAGE_STARTERS, ICON_CHOICES} from "./onboardingChoices"
import {OnboardingComposer} from "./OnboardingComposer"
import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import {ONBOARDING_NAME_MAX, type OnboardingAgent} from "./onboardingDraft"
import {OnboardingHueSlider} from "./OnboardingHueSlider"
import {useGlyphPaths} from "./useAgentGlyph"

const copy = ONBOARDING_COPY.creator

/** The blank start, built where a template's panel would be: face, name, and a first message that creates. */
export const OnboardingScratchPanel = ({
    agent,
    onChange,
    create,
}: {
    agent: OnboardingAgent
    onChange: (patch: Partial<Omit<OnboardingAgent, "apps">>) => void
    create: OnboardingCreateState
}) => {
    const glyphs = useGlyphPaths()
    const {icon, color} = agent.icon
    return (
        <section
            aria-label={ONBOARDING_COPY.gallery.scratch}
            className="bg-muted flex min-w-0 flex-col rounded-xl"
        >
            <div className="flex min-w-0 flex-col gap-2.5 p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <OnboardingAgentChip
                        icon={agent.icon}
                        size={16}
                        className="size-7 rounded-md"
                    />
                    <span aria-hidden className="bg-border h-5 w-px shrink-0" />
                    <div
                        role="group"
                        aria-label={copy.icon}
                        className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [mask-image:linear-gradient(90deg,#000_88%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {ICON_CHOICES.map((name) => {
                            const active = name === icon
                            const path = glyphs.get(name)
                            return (
                                <button
                                    type="button"
                                    key={name}
                                    title={name}
                                    aria-label={copy.iconLabel(name)}
                                    aria-pressed={active}
                                    onClick={() => onChange({icon: {icon: name, color}})}
                                    style={active ? agentIconChipStyle(color) : undefined}
                                    className={cn(
                                        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 p-0 transition-colors",
                                        FOCUS_RING,
                                        active
                                            ? AGENT_ICON_CHIP_CLASS
                                            : "text-muted-foreground hover:bg-foreground/5 bg-transparent",
                                    )}
                                >
                                    {path ? <AgentIcon path={path} size={16} /> : null}
                                </button>
                            )
                        })}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:h-6 sm:flex-nowrap sm:pl-[49px]">
                    {AGENT_ICON_COLORS.map(([solid]) => (
                        <button
                            type="button"
                            key={solid}
                            aria-label={copy.colorLabel(solid)}
                            aria-pressed={solid === color}
                            onClick={() => onChange({icon: {icon, color: solid}})}
                            // A swatch shows the colour it picks; that colour is data, not a theme role.
                            style={{
                                background: solid,
                                outline: solid === color ? `2px solid ${solid}` : undefined,
                            }}
                            className="border-foreground/10 size-5 shrink-0 cursor-pointer rounded-full border border-solid p-0 outline-offset-2"
                        />
                    ))}
                    <span
                        aria-hidden
                        className="bg-border mx-1 h-3.5 w-px shrink-0 max-sm:hidden"
                    />
                    <OnboardingHueSlider
                        className="max-sm:mt-2 max-sm:basis-full"
                        color={color}
                        onChange={(hex) => onChange({icon: {icon, color: hex}})}
                    />
                </div>
            </div>
            <div className="flex flex-col gap-3 p-3">
                <Input
                    autoFocus
                    aria-label={copy.name}
                    value={agent.name}
                    maxLength={ONBOARDING_NAME_MAX}
                    placeholder={copy.namePlaceholder}
                    onChange={(event) => onChange({name: event.target.value})}
                    className="bg-background h-9"
                />
                <div className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium leading-[18px]">
                        {copy.firstMessage}
                    </span>
                    <OnboardingComposer
                        message={agent.firstMessage}
                        onMessage={(firstMessage) => onChange({firstMessage})}
                        create={create}
                        starters={FIRST_MESSAGE_STARTERS}
                    />
                </div>
            </div>
        </section>
    )
}
