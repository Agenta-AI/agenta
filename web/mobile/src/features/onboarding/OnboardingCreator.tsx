import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {
    AGENT_ICON_CHIP_CLASS,
    AGENT_ICON_COLORS,
    AgentIcon,
    agentIconChipStyle,
} from "@agenta/ui/agent-icon"
import {LoadingButton, SkeletonBlock, Textarea} from "@agenta/ui/ui"
import {LockSimple} from "@phosphor-icons/react"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {OnboardingAgentPreview} from "./OnboardingAgentPreview"
import type {ConnectedApps} from "./onboardingApps"
import {OnboardingAppsField} from "./OnboardingAppsField"
import {ICON_CHOICES} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import {onboardingHeadingId, type OnboardingAgent} from "./onboardingDraft"
import {useGlyphPaths} from "./useAgentGlyph"

const copy = ONBOARDING_COPY.creator
const LABEL = "text-[13px] font-medium leading-[18px]"
const SURFACE = "bg-background ring-foreground/10 shadow-xs ring-1"

/**
 * A picked template, reviewed before it is created: its own name and instructions shown as set,
 * its face, apps and first message chosen here, beside a live preview of the agent.
 */
export const OnboardingCreator = ({
    agent,
    template,
    suggestedApps,
    connectedApps,
    toolsEnabled,
    onChange,
    onApp,
    create,
}: {
    agent: OnboardingAgent
    /** The picked template, once the catalog has it. */
    template: AgentStarterTemplate | null
    suggestedApps: readonly string[]
    connectedApps: ConnectedApps
    toolsEnabled: boolean
    onChange: (patch: Partial<Omit<OnboardingAgent, "apps">>) => void
    onApp: (key: string, on: boolean) => void
    create: OnboardingCreateState
}) => {
    const glyphs = useGlyphPaths()
    const {icon, color} = agent.icon
    const locked = (value: string | undefined, tall = false) =>
        value ? (
            <div
                className={cn(
                    SURFACE,
                    "text-muted-foreground flex rounded-lg px-3 text-sm",
                    tall ? "py-3 leading-[21px]" : "h-11 items-center",
                )}
            >
                {value}
            </div>
        ) : (
            <SkeletonBlock className={tall ? "h-24 rounded-lg" : "h-11 rounded-lg"} />
        )

    return (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 md:grid-cols-[minmax(0,1fr)_minmax(300px,440px)]">
            <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                    <h1
                        id={onboardingHeadingId("creator")}
                        tabIndex={-1}
                        className={ONBOARDING_COPY.headingClass}
                    >
                        {copy.fromTemplateTitle}
                    </h1>
                    <p className="text-muted-foreground m-0 text-[15px] leading-[22px]">
                        {template ? copy.fromTemplateSubtitle(template.name) : ""}
                    </p>
                </div>
                <div className="flex flex-col gap-2">
                    <span className={LABEL}>{copy.name}</span>
                    {locked(template?.name)}
                </div>
                <div className="flex flex-col gap-2">
                    <span className={LABEL}>{copy.icon}</span>
                    <div className={cn(SURFACE, "flex flex-col gap-3 rounded-[10px] p-3.5")}>
                        <div
                            role="group"
                            aria-label={copy.icon}
                            className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5"
                        >
                            {ICON_CHOICES.map((name) => {
                                const active = name === icon
                                const path = glyphs.get(name)
                                return (
                                    <button
                                        type="button"
                                        key={name}
                                        aria-label={copy.iconLabel(name)}
                                        aria-pressed={active}
                                        onClick={() => onChange({icon: {icon: name, color}})}
                                        style={active ? agentIconChipStyle(color) : undefined}
                                        className={cn(
                                            "inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border-0 p-0 transition-colors",
                                            FOCUS_RING,
                                            active
                                                ? cn(AGENT_ICON_CHIP_CLASS, "ring-foreground ring-[1.5px]")
                                                : "text-foreground hover:bg-accent bg-transparent",
                                        )}
                                    >
                                        {path ? <AgentIcon path={path} size={17} /> : null}
                                    </button>
                                )
                            })}
                        </div>
                        <div aria-hidden className="bg-accent h-px" />
                        <div className="flex flex-wrap gap-2">
                            {AGENT_ICON_COLORS.map(([solid]) => {
                                const active = solid.toLowerCase() === color.toLowerCase()
                                return (
                                    <button
                                        type="button"
                                        key={solid}
                                        aria-label={copy.colorLabel(solid)}
                                        aria-pressed={active}
                                        onClick={() => onChange({icon: {icon, color: solid}})}
                                        // A swatch shows the colour it picks; that colour is data.
                                        style={{background: solid}}
                                        className={cn(
                                            "size-7 cursor-pointer rounded-lg border-0 p-0 transition-[box-shadow,scale]",
                                            FOCUS_RING,
                                            active
                                                ? "ring-offset-background ring-foreground scale-105 ring-[1.5px] ring-offset-2"
                                                : "ring-foreground/10 ring-1 ring-inset",
                                        )}
                                    />
                                )
                            })}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <span className={LABEL}>{copy.instructions}</span>
                    {locked(template?.instructions, true)}
                    <span className="text-muted-foreground flex items-start gap-1.5 text-xs">
                        <LockSimple size={13} className="mt-px shrink-0" />
                        {copy.fromTemplateNote}
                    </span>
                </div>
                {toolsEnabled ? (
                    <div className="flex flex-col gap-2">
                        <span className={LABEL}>
                            {copy.apps}{" "}
                            <span className="text-muted-foreground font-normal">
                                · {copy.optional}
                            </span>
                        </span>
                        <OnboardingAppsField
                            suggested={suggestedApps}
                            value={agent.apps}
                            onToggle={onApp}
                        />
                    </div>
                ) : null}
                <label className="flex flex-col gap-2">
                    <span className={LABEL}>{copy.firstMessage}</span>
                    <Textarea
                        rows={3}
                        value={agent.firstMessage}
                        placeholder={copy.firstMessagePlaceholder}
                        onChange={(event) => onChange({firstMessage: event.target.value})}
                        className="bg-background min-h-20 resize-y"
                    />
                    <span className="text-muted-foreground text-xs">
                        {copy.templateFirstMessageHint}
                    </span>
                </label>
                <div className="flex flex-col gap-2">
                    {create.error ? (
                        <p role="alert" className="text-destructive m-0 text-sm">
                            {create.error}
                        </p>
                    ) : null}
                    {!create.modelReady ? (
                        <p className="text-muted-foreground m-0 text-sm">
                            {copy.modelMissing}{" "}
                            <button
                                type="button"
                                onClick={create.onChooseModel}
                                className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-sm underline"
                            >
                                {copy.modelMissingAction}
                            </button>
                        </p>
                    ) : null}
                    <LoadingButton
                        loading={create.creating}
                        disabled={!create.modelReady || !create.complete}
                        onClick={create.onCreate}
                        className="bg-hero-action text-hero-action-foreground hover:bg-hero-action-hover h-12 w-full rounded-lg text-[15px] font-medium"
                    >
                        {create.creating ? copy.creating : copy.create}
                    </LoadingButton>
                </div>
            </div>
            <div className="sticky top-24 max-md:hidden">
                <OnboardingAgentPreview
                    agent={
                        template
                            ? {...agent, name: template.name, instructions: template.instructions}
                            : agent
                    }
                    connected={connectedApps}
                />
            </div>
        </div>
    )
}
