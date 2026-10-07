import {
    AGENT_ICON_CHIP_CLASS,
    AGENT_ICON_COLORS,
    AgentIcon,
    agentIconChipStyle,
} from "@agenta/ui/agent-icon"
import {Input, LoadingButton, Textarea} from "@agenta/ui/ui"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {OnboardingAgentChip} from "./OnboardingAgentChip"
import {FIRST_MESSAGE_STARTERS, ICON_CHOICES} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import {ONBOARDING_NAME_MAX, type OnboardingAgent} from "./onboardingDraft"
import {OnboardingHueSlider} from "./OnboardingHueSlider"
import {useGlyphPaths} from "./useAgentGlyph"

const copy = ONBOARDING_COPY.creator

/** The blank start, built where a template's panel would be: face, name, first message, Create. */
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
    const status = create.error ? (
        <span role="alert" className="text-destructive text-xs">
            {create.error}
        </span>
    ) : !create.modelReady ? (
        <span className="text-muted-foreground text-xs">
            {copy.modelMissing}{" "}
            <button
                type="button"
                onClick={create.onChooseModel}
                className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-xs underline"
            >
                {copy.modelMissingAction}
            </button>
        </span>
    ) : !create.complete ? (
        <span className="text-muted-foreground text-xs">{copy.needsMessage}</span>
    ) : (
        <span />
    )

    return (
        <section aria-label={ONBOARDING_COPY.gallery.scratch} className="bg-muted flex flex-col rounded-xl">
            <div className="flex flex-col gap-2.5 p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <OnboardingAgentChip icon={agent.icon} size={16} className="size-7 rounded-md" />
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
                <div className="flex h-6 items-center gap-1.5 sm:pl-[49px]">
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
                    <span aria-hidden className="bg-border mx-1 h-3.5 w-px shrink-0" />
                    <OnboardingHueSlider
                        color={color}
                        onChange={(hex) => onChange({icon: {icon, color: hex}})}
                    />
                </div>
            </div>
            <div className="flex flex-col gap-3 p-3">
                <Input
                    aria-label={copy.name}
                    value={agent.name}
                    maxLength={ONBOARDING_NAME_MAX}
                    placeholder={copy.namePlaceholder}
                    onChange={(event) => onChange({name: event.target.value})}
                    className="bg-background h-9"
                />
                <div className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium leading-[18px]">{copy.firstMessage}</span>
                    <div className="flex items-stretch gap-2 max-sm:flex-col">
                        <Textarea
                            aria-label={copy.firstMessage}
                            rows={5}
                            value={agent.firstMessage}
                            placeholder={copy.firstMessagePlaceholder}
                            onChange={(event) => onChange({firstMessage: event.target.value})}
                            className="bg-background min-h-[120px] min-w-0 flex-1 resize-none"
                        />
                        <div
                            role="group"
                            aria-label={copy.starters}
                            className="flex shrink-0 flex-col gap-1 overflow-y-auto pb-4 [mask-image:linear-gradient(180deg,#000_0,#000_calc(100%-16px),transparent_100%)] [scrollbar-width:none] max-sm:max-h-[120px] sm:h-[120px] sm:w-[44%] sm:max-w-60 [&::-webkit-scrollbar]:hidden"
                        >
                            {FIRST_MESSAGE_STARTERS.map((text) => (
                                <button
                                    type="button"
                                    key={text}
                                    onClick={() => onChange({firstMessage: text})}
                                    className={cn(
                                        "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground min-h-7 w-full shrink-0 cursor-pointer rounded-md border-0 px-2 py-[5px] text-left text-xs leading-4",
                                        FOCUS_RING,
                                    )}
                                >
                                    {text}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
                {status}
                <LoadingButton
                    size="sm"
                    loading={create.creating}
                    disabled={!create.modelReady || !create.complete}
                    onClick={create.onCreate}
                >
                    {create.creating ? copy.creating : copy.create}
                </LoadingButton>
            </div>
        </section>
    )
}
