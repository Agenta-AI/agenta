import {tintForColor} from "@agenta/ui/agent-icon"
import {ArrowUp} from "@phosphor-icons/react"
import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {AppTileStack} from "../marketplace/AppTileStack"

import {OnboardingAgentChip} from "./OnboardingAgentChip"
import {appIdentity, type ConnectedApps} from "./onboardingApps"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {FIRST_AGENT_FALLBACK_NAME, type OnboardingAgent} from "./onboardingDraft"

const copy = ONBOARDING_COPY.creator

/** The agent as it will look, on a dotted stage: face, name, brief, apps, and its composer. */
export const OnboardingAgentPreview = ({
    agent,
    connected,
}: {
    agent: OnboardingAgent
    /** Only a connected app joins the agent, so only a connected app is previewed. */
    connected: ConnectedApps
}) => {
    const presets = useMotionPresets()
    const name = agent.name.trim() || FIRST_AGENT_FALLBACK_NAME
    const instructions = agent.instructions.trim()
    const apps = agent.apps
        .filter((key) => connected.has(key))
        .map((key) => appIdentity(key, connected))
    const tint = tintForColor(agent.icon.color)
    return (
        <section
            aria-label={copy.previewLabel}
            className="bg-accent box-border flex min-h-[520px] items-center justify-center rounded-2xl bg-[radial-gradient(color-mix(in_srgb,var(--color-foreground)_14%,transparent)_1px,transparent_1px)] bg-[size:18px_18px] p-7"
        >
            <div className="bg-card ring-foreground/10 flex w-full max-w-[340px] flex-col overflow-hidden rounded-2xl shadow-2xl ring-1">
                <div
                    // The wash takes the agent's own colour, which is data rather than a theme role.
                    style={{
                        background: `linear-gradient(180deg, color-mix(in srgb, ${tint} 60%, transparent) 0%, transparent 100%)`,
                    }}
                    className="flex flex-col gap-3.5 px-[22px] pb-5 pt-6 transition-[background] duration-300 motion-reduce:transition-none"
                >
                    {/* Keyed by the face, so a new icon or colour pops in. */}
                    <motion.span
                        key={`${agent.icon.icon}:${agent.icon.color}`}
                        variants={presets.pop}
                        initial="initial"
                        animate="animate"
                        className="flex w-fit"
                    >
                        <OnboardingAgentChip
                            icon={agent.icon}
                            size={28}
                            className="ring-foreground/5 size-[60px] rounded-2xl shadow-md ring-1"
                        />
                    </motion.span>
                    <div className="flex flex-col gap-0.5">
                        <span className="truncate text-xl font-semibold leading-[26px] tracking-[-0.01em]">
                            {name}
                        </span>
                        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs leading-[18px]">
                            <span className="bg-success size-1.5 rounded-full" />
                            {copy.previewAgent}
                        </span>
                    </div>
                </div>
                <div className="flex flex-col gap-3.5 px-[22px] pb-[22px] pt-[18px]">
                    <p
                        className={cn(
                            "m-0 line-clamp-4 min-h-10 text-[13px] leading-5",
                            instructions ? "text-foreground/80" : "text-muted-foreground",
                        )}
                    >
                        {instructions || copy.previewEmpty}
                    </p>
                    {apps.length > 0 ? (
                        <div className="flex min-w-0 items-center gap-2">
                            <AppTileStack
                                decorative
                                size="xs"
                                apps={apps.map((app) => ({slug: app.key, name: app.name, logo: app.logo}))}
                            />
                            <span className="text-muted-foreground truncate text-xs">
                                {apps.map((app) => app.name).join(", ")}
                            </span>
                        </div>
                    ) : null}
                    <div className="ring-accent text-muted-foreground flex h-10 items-center justify-between rounded-[9px] pl-3 pr-1.5 text-[13px] ring-1">
                        <span className="truncate">
                            {agent.firstMessage.trim() || copy.previewComposer(name)}
                        </span>
                        <span
                            style={{background: tint}}
                            className="text-hero-action-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-[7px]"
                        >
                            <ArrowUp size={13} />
                        </span>
                    </div>
                </div>
            </div>
        </section>
    )
}
