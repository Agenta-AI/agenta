import {PaperPlaneRight} from "@phosphor-icons/react"
import {motion} from "motion/react"

import {useMotionPresets} from "@/lib/motion/presets"
import {cn} from "@/lib/utils"

import {OnboardingAgentChip} from "./OnboardingAgentChip"
import {appIdentity, type ConnectedApps} from "./onboardingApps"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {FIRST_AGENT_FALLBACK_NAME, type OnboardingAgent} from "./onboardingDraft"

const copy = ONBOARDING_COPY.creator

/** What the creator is making, drawn as the agent will look: face, brief, apps, first message. */
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
    return (
        <section
            aria-label={copy.previewLabel}
            className="border-border bg-background flex flex-col gap-4 rounded-2xl border border-solid p-5"
        >
            <span className="text-muted-foreground text-xs font-medium">{copy.previewLabel}</span>
            <div className="flex items-center gap-3">
                {/* Keyed by the face, so a new icon or colour pops in. */}
                <motion.span
                    key={`${agent.icon.icon}:${agent.icon.color}`}
                    variants={presets.pop}
                    initial="initial"
                    animate="animate"
                    className="flex"
                >
                    <OnboardingAgentChip
                        icon={agent.icon}
                        size={24}
                        className="size-11 rounded-xl"
                    />
                </motion.span>
                <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{name}</span>
                    <span className="text-muted-foreground text-xs">{copy.previewAgent}</span>
                </span>
            </div>
            <p
                className={cn(
                    "m-0 line-clamp-6 whitespace-pre-line text-sm",
                    instructions ? "text-foreground" : "text-muted-foreground",
                )}
            >
                {instructions || copy.previewEmpty}
            </p>
            {apps.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {apps.map((app) => (
                        <span
                            key={app.key}
                            className="bg-muted inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                        >
                            <img src={app.logo} alt="" className="size-3.5 object-contain" />
                            {app.name}
                        </span>
                    ))}
                </div>
            ) : null}
            <div className="border-border flex items-end gap-2 rounded-xl border border-solid p-2.5">
                <span
                    className={cn(
                        "line-clamp-3 flex-1 text-sm",
                        agent.firstMessage.trim() ? "text-foreground" : "text-muted-foreground",
                    )}
                >
                    {agent.firstMessage.trim() || copy.previewComposer(name)}
                </span>
                <span className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-full">
                    <PaperPlaneRight size={13} weight="fill" />
                </span>
            </div>
        </section>
    )
}
