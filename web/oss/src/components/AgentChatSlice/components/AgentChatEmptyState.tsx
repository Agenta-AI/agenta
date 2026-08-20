import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {AgentIntroCard} from "@agenta/entity-ui/agent"
import {Tag} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {ArrowRight, Play, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

// Safe: assets/constants is a leaf (imports only dynamicEnv), unlike the agent-home components.
import {TEMPLATE_STRIP_MODE} from "@/oss/components/pages/agent-home/assets/constants"
import Reveal from "@/oss/components/pages/agent-home/PlaygroundOnboarding/Reveal"

/** Copy for the onboarding ("what do you want to build?") empty state — kept local to avoid a circular
 * import with the agent-home module (which itself imports from this slice). */
const ONBOARDING_COPY = {
    eyebrowNew: "New",
    eyebrow: "Agent builder",
    title: "What do you want to build?",
    subtitle:
        "Describe an agent in plain language below — I'll name it, wire up what it needs, and run it, all right here.",
    // Strip-era subtitle (TEMPLATE_STRIP_MODE): templates live in the strip below, not the left panel.
    subtitleStrip:
        "Describe an agent in plain language — we'll create and name it, then run it right here.",
    hint: "← Not sure? Pick a template on the left",
    videoDuration: "2:04",
    videoLabel: "Watch 2-min tour",
}

/** Quick-start prompts in the onboarding empty state — click to prefill the composer. Kept HERE (not
 * the composer footer) so the composer's height doesn't shift when the empty state clears on submit. */
const ONBOARDING_STARTERS = ["Triage #support tickets", "Review my PRs", "Summarize standups"]

/** Curated starter prompts for the Build-mode empty state. Clicking one sends it. */
const BUILD_STARTERS = [
    "What can you do?",
    "Show me your current configuration",
    "List the tools you can call",
]

/** Read the agent config shape (same layout as ContextTab / buildAgentRequest). */

const Bot = ({size = 44}: {size?: number}) => (
    <div
        className="flex shrink-0 items-center justify-center rounded-full bg-colorFillTertiary"
        style={{width: size, height: size}}
    >
        <Robot size={Math.round(size * 0.5)} className="text-colorTextSecondary" />
    </div>
)

/**
 * The agent chat empty state, adapting to the playground mode:
 *  - Chat (maximized): a warm minimal welcome.
 *  - Build: an agent-aware card (name, model, capabilities, a one-line summary) plus starter
 *    prompts that send on click — for the team building the agent.
 *  - Build + first run: when the agent was just created with a starting prompt (`firstRunPrompt`),
 *    that prompt is shown prominently with a Start CTA instead of the generic starters — so the
 *    kickoff message reads as "here's what we'll do", not text the user has to notice in the input.
 */
const AgentChatEmptyState = ({
    entityId,
    onStart,
    firstRunPrompt,
    showTemplateStrip = false,
    canStart = true,
    onboarding = false,
    onPrefill,
}: {
    entityId: string
    onStart: (text: string) => void
    /** A just-created agent's starting prompt — surfaced here instead of pre-filling the composer. */
    firstRunPrompt?: string | null
    /**
     * The composer-docked template strip is rendering (flag owned by AgentConversation, which hands
     * the same value to the dock) — it replaces the starter pills. When it is NOT rendering, the
     * pills stay, so a blank session on an existing agent never lands on an actionless empty state.
     */
    showTemplateStrip?: boolean
    /** Whether the Start CTA is enabled (false when the model isn't connected). */
    canStart?: boolean
    /**
     * Playground-native onboarding state: the pre-commit "what do you want to build?" hero (this IS the
     * agent-chat view — the composer below renders the Create-agent / Continue-in-IDE controls). Takes
     * precedence over the other states.
     */
    onboarding?: boolean
    /** Prefill the composer with a quick-start prompt (onboarding "Try" chips). */
    onPrefill?: (text: string) => void
}) => {
    const buildMode = !useAtomValue(chatPanelMaximizedAtom)

    if (onboarding && TEMPLATE_STRIP_MODE) {
        // Strip era: no tour video, no "Agent builder" eyebrow, no left-panel hint/starters — the
        // strip (rendered by the caller, docked snugly below the composer) is the only browsing
        // surface. Top-aligned (not vertically centered) so hero, composer, and strip read as one
        // tight group instead of floating in the middle of the panel.
        return (
            <div className="relative flex w-full flex-col py-6">
                <Reveal className="mx-auto flex w-full max-w-[880px] flex-col gap-3">
                    <h2 className="m-0 text-[30px] font-semibold leading-tight text-colorText">
                        {ONBOARDING_COPY.title}
                    </h2>
                    <span className="text-[15px] text-[var(--ag-colorTextSecondary)]">
                        {ONBOARDING_COPY.subtitleStrip}
                    </span>
                </Reveal>
            </div>
        )
    }

    if (onboarding) {
        return (
            <div className="relative flex h-full min-h-[420px] w-full flex-1 flex-col justify-center py-6">
                {/* Tutorial video — floats top-right (placeholder poster until a clip is wired). */}
                <Reveal
                    delay={120}
                    className="absolute right-2 top-2 flex flex-col items-center gap-1.5"
                >
                    <button
                        type="button"
                        aria-label={ONBOARDING_COPY.videoLabel}
                        className="relative flex size-[68px] cursor-pointer items-center justify-center overflow-hidden rounded-full border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] p-0 transition-opacity hover:opacity-90"
                    >
                        <span
                            className="absolute inset-0 opacity-50"
                            style={{
                                background:
                                    "repeating-linear-gradient(45deg, transparent, transparent 5px, var(--ag-colorFillSecondary) 5px, var(--ag-colorFillSecondary) 10px)",
                            }}
                        />
                        <Play
                            weight="fill"
                            size={18}
                            className="relative text-[var(--ag-colorText)]"
                        />
                        <span className="absolute bottom-1.5 text-[12px] font-semibold text-[var(--ag-colorText)]">
                            {ONBOARDING_COPY.videoDuration}
                        </span>
                    </button>
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        {ONBOARDING_COPY.videoLabel}
                    </span>
                </Reveal>

                {/* Same centered column as the composer (CHAT_COLUMN = mx-auto max-w-[880px]) so the
                    hero's left edge lines up with the editor's left edge, not a narrower centered block. */}
                <Reveal className="mx-auto flex w-full max-w-[880px] flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <Tag
                            tone="processing"
                            label={ONBOARDING_COPY.eyebrowNew}
                            className="m-0 rounded px-1.5 py-0 text-[12px] font-semibold uppercase leading-5"
                        />
                        <span className="text-xs font-medium text-[var(--ag-colorTextSecondary)]">
                            {ONBOARDING_COPY.eyebrow}
                        </span>
                    </div>
                    <h2 className="m-0 text-[30px] font-semibold leading-tight text-colorText">
                        {ONBOARDING_COPY.title}
                    </h2>
                    <span className="text-[15px] text-[var(--ag-colorTextSecondary)]">
                        {ONBOARDING_COPY.subtitle}
                    </span>
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        {ONBOARDING_COPY.hint}
                    </span>

                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-[var(--ag-colorTextTertiary)]">Try</span>
                        {ONBOARDING_STARTERS.map((starter) => (
                            <button
                                key={starter}
                                type="button"
                                onClick={() => onPrefill?.(starter)}
                                className="box-border cursor-pointer rounded-full border border-solid border-[var(--ag-colorBorder)] bg-transparent px-3 py-1 text-xs text-[var(--ag-colorTextSecondary)] transition-colors hover:border-[var(--ag-colorPrimary)] hover:text-[var(--ag-colorText)]"
                            >
                                {starter}
                            </button>
                        ))}
                    </div>
                </Reveal>
            </div>
        )
    }

    if (!buildMode) {
        return (
            <div className="m-auto flex max-w-sm flex-col items-center gap-2.5 text-center">
                <Bot />
                <span className="text-base font-medium text-colorText">
                    What can I help you with?
                </span>
                <span className="text-xs leading-relaxed text-colorTextSecondary">
                    Ask a question, or describe a task you want this agent to run.
                </span>
            </div>
        )
    }

    return (
        <div className="m-auto w-full max-w-[420px]">
            <AgentIntroCard entityId={entityId} />
            <div className="mt-3 flex flex-col gap-3">
                {firstRunPrompt ? (
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-colorTextSecondary">
                            We'll start with
                        </span>
                        <div className="whitespace-pre-wrap break-words rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2 text-xs leading-relaxed text-colorText">
                            {firstRunPrompt}
                        </div>
                        <Button
                            disabled={!canStart}
                            onClick={() => onStart(firstRunPrompt)}
                            className="self-start shadow-none"
                        >
                            Start
                            <ArrowRight size={14} />
                        </Button>
                        {canStart ? null : (
                            <span className="text-xs text-colorTextSecondary">
                                Connect a model below to start.
                            </span>
                        )}
                    </div>
                ) : showTemplateStrip ? null : ( // The composer-docked strip is up; it replaces the starter pills.
                    <div className="flex flex-col items-start gap-1.5">
                        <span className="text-xs text-colorTextSecondary">Try</span>
                        {BUILD_STARTERS.map((starter) => (
                            <button
                                key={starter}
                                type="button"
                                onClick={() => onStart(starter)}
                                className="flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-solid border-colorBorder bg-colorBgContainer px-3 py-1.5 text-left text-xs text-colorTextSecondary transition-colors hover:border-colorPrimary hover:text-colorText"
                            >
                                <ArrowRight size={13} className="shrink-0" />
                                <span className="truncate">{starter}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default AgentChatEmptyState
