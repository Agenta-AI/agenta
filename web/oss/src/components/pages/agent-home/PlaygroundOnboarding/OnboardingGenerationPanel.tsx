import {useCallback, useRef} from "react"

import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Play} from "@phosphor-icons/react"
import {App, Tag, Typography} from "antd"

import {buildIdeCommand, HERO, TUTORIAL, TUTORIAL_VIDEO} from "../assets/constants"
import AgentComposer from "../components/AgentComposer"

import {useOnboardingContext} from "./OnboardingContext"

/** Starter prompts shown under the composer — click to prefill it. */
const STARTERS = ["Triage #support tickets", "Review my PRs", "Summarize standups"]

/**
 * The onboarding right panel — the agent-chat surface's slot while the agent is still ephemeral. A
 * "Watch 2-min tour" video floats top-right; the "What do you want to build?" hero sits in the upper
 * area and the reused Home composer + starter chips sit lower (matching the design). "Create agent"
 * commits THIS mount's ephemeral IN PLACE via the onboarding context; "Continue in IDE" copies the
 * install command + prompt. Once committed, `PlaygroundOnboarding` swaps this slot for the live chat.
 */
const OnboardingGenerationPanel = () => {
    const {message} = App.useApp()
    const {commit, committing} = useOnboardingContext()
    const composerRef = useRef<RichChatInputHandle>(null)

    const readPrompt = useCallback(() => composerRef.current?.getMarkdown().trim() ?? "", [])

    const onCreate = useCallback(() => {
        if (committing) return
        commit(readPrompt())
    }, [committing, commit, readPrompt])

    const onContinueInIde = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(buildIdeCommand(readPrompt()))
            message.success("Copied install command + prompt to your clipboard")
        } catch {
            message.error("Couldn't copy to clipboard")
        }
    }, [readPrompt, message])

    return (
        <div className="ag-canvas relative flex h-full w-full flex-col overflow-y-auto">
            {/* Tutorial video — floats top-right (placeholder poster until the clip is wired). */}
            {TUTORIAL_VIDEO ? (
                <div className="absolute right-8 top-8 z-10 flex flex-col items-center gap-1.5">
                    <button
                        type="button"
                        aria-label={TUTORIAL.title}
                        className="relative flex size-[72px] cursor-pointer items-center justify-center overflow-hidden rounded-full border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillTertiary)] p-0 transition-opacity hover:opacity-90"
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
                            size={20}
                            className="relative text-[var(--ag-colorText)]"
                        />
                        {TUTORIAL_VIDEO.durationLabel ? (
                            <span className="absolute bottom-2 text-[10px] font-semibold text-[var(--ag-colorText)]">
                                {TUTORIAL_VIDEO.durationLabel}
                            </span>
                        ) : null}
                    </button>
                    <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                        Watch 2-min tour
                    </span>
                </div>
            ) : null}

            <div className="mx-auto flex h-full min-h-[560px] w-full max-w-[720px] flex-col px-6">
                {/* Empty top space so the hero sits in the upper-middle, like the design. */}
                <div className="h-[26%] shrink-0" />

                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <Tag
                            color="processing"
                            className="!m-0 !rounded !px-1.5 !py-0 !text-[10px] !font-semibold !uppercase !leading-5"
                        >
                            {HERO.eyebrowNew}
                        </Tag>
                        <span className="text-xs font-medium text-[var(--ag-colorTextSecondary)]">
                            {HERO.eyebrowLabel}
                        </span>
                    </div>
                    <Typography.Title level={2} className="!m-0 !text-[30px] !leading-tight">
                        {HERO.title}
                    </Typography.Title>
                    <Typography.Text className="!text-[15px] !text-[var(--ag-colorTextSecondary)]">
                        {HERO.subtitle}
                    </Typography.Text>
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                        ← Not sure? Pick a template on the left
                    </span>
                </div>

                {/* Composer + starters — pushed to the lower area. */}
                <div className="mt-auto flex flex-col gap-3 pb-14 pt-10">
                    <AgentComposer
                        composerRef={composerRef}
                        onCreate={onCreate}
                        onContinueInIde={onContinueInIde}
                    />
                    <div className="flex flex-wrap items-center gap-2 pl-1">
                        <span className="text-xs text-[var(--ag-colorTextTertiary)]">Try</span>
                        {STARTERS.map((starter) => (
                            <button
                                key={starter}
                                type="button"
                                onClick={() => composerRef.current?.setMarkdown(starter)}
                                className="box-border cursor-pointer rounded-full border border-solid border-[var(--ag-colorBorder)] bg-transparent px-3 py-1 text-xs text-[var(--ag-colorTextSecondary)] transition-colors hover:border-[var(--ag-colorPrimary)] hover:text-[var(--ag-colorText)]"
                            >
                                {starter}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default OnboardingGenerationPanel
